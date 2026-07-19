/*
 *  Description: Git-based document storage — every write (create/update/delete/move)
 *               is a git commit in a per-team bare repository. There is no database
 *               table for documents; the git tree IS the source of truth. Reads pull
 *               blobs straight from the bare repo (no worktree); writes go through a
 *               throwaway worktree clone. Concurrency is per team via a ReentrantLock.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

package app.microteams.team.documents

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.io.path.createTempDirectory
import kotlin.io.path.writeText
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.revwalk.RevCommit
import org.eclipse.jgit.revwalk.RevWalk
import org.eclipse.jgit.treewalk.CanonicalTreeParser
import org.eclipse.jgit.treewalk.TreeWalk
import org.rucca.cheese.common.error.BaseError
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service

data class CommitInfo(
    val sha: String,
    val message: String,
    val author: String,
    val timestamp: Long,
)

data class TreeEntry(val path: String, val mode: String, val type: String, val commitSha: String)

@Service
class GitService {

    private val logger = LoggerFactory.getLogger(GitService::class.java)
    private val locks = ConcurrentHashMap<Long, ReentrantLock>()

    /** Base directory for team bare repos. Override per environment (tests use a temp dir). */
    @Value("\${application.git-repo-base:/var/microteams/repos/teams}")
    var repoBase: String = "/var/microteams/repos/teams"

    private fun lock(teamId: Long): ReentrantLock =
        locks.computeIfAbsent(teamId) { ReentrantLock() }

    private fun bareRepoPath(teamId: Long): Path = Paths.get(repoBase, "$teamId.git")

    /**
     * The team's bare repo directory, so the git smart-HTTP endpoint can serve it over the wire.
     * Whether it exists is the caller's concern — a repo is created with the team, and a missing
     * one is a 404 to the git client.
     */
    fun bareRepoDir(teamId: Long): File = bareRepoPath(teamId).toFile()

    /**
     * Rejects paths that could escape the repo. Document paths are *logical* git paths: always
     * repo-relative, forward-slash separated, no drive/absolute prefix, no `..`. Reads go through
     * git's object model (immune to filesystem traversal on their own), but writes materialise the
     * path on a real filesystem, so this guard is mandatory there and applied uniformly for defence
     * in depth.
     */
    private fun requireSafePath(path: String) {
        require(path.isNotBlank()) { "empty path" }
        require(!path.startsWith("/")) { "absolute path not allowed: $path" }
        require(!path.startsWith("\\")) { "absolute path not allowed: $path" }
        require(path.split('/').none { it == ".." }) { "path traversal not allowed: $path" }
    }

    /**
     * Resolves [relative] under [root] and verifies the normalised result stays inside [root]. This
     * is the sink-side barrier: even though [requireSafePath] already rejects absolute paths and
     * `..`, materialising a user-controlled path on the filesystem is guarded here too (and makes
     * the containment explicit to static analysis).
     */
    private fun resolveInside(root: Path, relative: String): Path {
        val base = root.toAbsolutePath().normalize()
        val resolved = base.resolve(relative).normalize()
        if (!resolved.startsWith(base)) {
            throw IllegalArgumentException("path escapes repository: $relative")
        }
        return resolved
    }

    // -- public API --------------------------------------------------------

    fun initBareRepo(teamId: Long) {
        val dir = bareRepoPath(teamId)
        if (dir.resolve("HEAD").toFile().isFile) {
            logger.info("bare repo already exists for team {}", teamId)
            return
        }
        Files.createDirectories(dir)
        lock(teamId).useLock { Git.init().setBare(true).setDirectory(dir.toFile()).call().use {} }
        // Seed an empty initial commit so the clone→commit→push cycle used by every
        // write works: a freshly `init --bare`'d repo has no branch for a clone to
        // commit onto. The seed leaves no files — a new team starts empty.
        lock(teamId).useLock {
            withWorktree(teamId) { git ->
                git.commit()
                    .setAllowEmpty(true)
                    .setMessage("init")
                    .setAuthor("microteams", "")
                    .call()
            }
        }
        logger.info("initialized bare repo for team {}", teamId)
    }

    fun createDocument(
        teamId: Long,
        filePath: String,
        content: String,
        author: String,
    ): CommitInfo = writeAndCommit(teamId, filePath, content, "create: $filePath", author)

    fun updateDocument(
        teamId: Long,
        filePath: String,
        newContent: String,
        author: String,
    ): CommitInfo = writeAndCommit(teamId, filePath, newContent, "update: $filePath", author)

    fun deleteDocument(teamId: Long, filePath: String, author: String): CommitInfo {
        requireSafePath(filePath)
        return lock(teamId).useLock {
            withWorktree(teamId) { git ->
                git.rm().addFilepattern(filePath).call()
                git.commit().setMessage("delete: $filePath").setAuthor(author, "").call()
                commitInfo(git)
            }
        }
    }

    fun moveDocument(teamId: Long, oldPath: String, newPath: String, author: String): CommitInfo {
        requireSafePath(oldPath)
        requireSafePath(newPath)
        return lock(teamId).useLock {
            withWorktree(teamId) { git ->
                val dir = git.repository.workTree.toPath()
                val source = resolveInside(dir, oldPath).toFile()
                val target = resolveInside(dir, newPath).toFile()
                if (!source.exists()) throw NoSuchFileException(oldPath)
                Files.createDirectories(target.parentFile.toPath())
                source.renameTo(target)
                git.add().addFilepattern(oldPath).setUpdate(true).call()
                git.add().addFilepattern(newPath).call()
                git.commit().setMessage("move: $oldPath -> $newPath").setAuthor(author, "").call()
                commitInfo(git)
            }
        }
    }

    /** Reads a file's content straight out of the bare repo's HEAD tree — no worktree clone. */
    fun getContent(teamId: Long, filePath: String): String {
        requireSafePath(filePath)
        return lock(teamId).useLock {
            openBare(teamId).use { git ->
                val repo = git.repository
                val head = repo.resolve(Constants.HEAD) ?: throw NoSuchFileException(filePath)
                RevWalk(repo).use { walk ->
                    val tree = walk.parseCommit(head).tree
                    TreeWalk.forPath(repo, filePath, tree)?.use { tw ->
                        String(repo.open(tw.getObjectId(0)).bytes, Charsets.UTF_8)
                    } ?: throw NoSuchFileException(filePath)
                }
            }
        }
    }

    fun getHistory(teamId: Long, filePath: String): List<CommitInfo> {
        requireSafePath(filePath)
        return lock(teamId).useLock {
            openBare(teamId).use { git ->
                git.log().addPath(filePath).call().map { it.toCommitInfo() }
            }
        }
    }

    fun getDiff(teamId: Long, commitSha: String): String =
        lock(teamId).useLock {
            openBare(teamId).use { git ->
                val repo = git.repository
                val objId = repo.resolve(commitSha) ?: throw NoSuchCommitException(commitSha)
                RevWalk(repo).use { walk ->
                    val commit = walk.parseCommit(objId)
                    val out = ByteArrayOutputStream()
                    val oldTree =
                        if (commit.parentCount == 0) emptyTree()
                        else parserFor(repo, walk.parseCommit(commit.getParent(0)))
                    git.diff()
                        .setOldTree(oldTree)
                        .setNewTree(parserFor(repo, commit))
                        .setOutputStream(out)
                        .call()
                    out.toString(Charsets.UTF_8)
                }
            }
        }

    /** All blobs reachable from HEAD, recursively — the flat file list for a team. */
    fun refreshIndex(teamId: Long): List<TreeEntry> =
        lock(teamId).useLock {
            openBare(teamId).use { git ->
                val repo = git.repository
                val head = repo.resolve(Constants.HEAD) ?: return@useLock emptyList<TreeEntry>()
                RevWalk(repo).use { walk ->
                    val commit = walk.parseCommit(head)
                    val entries = mutableListOf<TreeEntry>()
                    TreeWalk(repo).use { tw ->
                        tw.addTree(commit.tree)
                        tw.isRecursive = true
                        while (tw.next()) {
                            entries.add(
                                TreeEntry(
                                    path = tw.pathString,
                                    mode = tw.fileMode.toString(),
                                    type = if (tw.isSubtree) "tree" else "blob",
                                    commitSha = head.name,
                                )
                            )
                        }
                    }
                    entries
                }
            }
        }

    fun headCommit(teamId: Long): String? =
        lock(teamId).useLock {
            openBare(teamId).use { git -> git.repository.resolve(Constants.HEAD)?.name }
        }

    // -- internals ---------------------------------------------------------

    private fun writeAndCommit(
        teamId: Long,
        filePath: String,
        content: String,
        message: String,
        author: String,
    ): CommitInfo {
        requireSafePath(filePath)
        return lock(teamId).useLock {
            withWorktree(teamId) { git ->
                val target = resolveInside(git.repository.workTree.toPath(), filePath)
                Files.createDirectories(target.parent)
                target.writeText(content, Charsets.UTF_8)
                git.add().addFilepattern(filePath).call()
                if (git.status().call().isClean) {
                    return@withWorktree commitInfo(git) // idempotent: content unchanged
                }
                git.commit().setMessage(message).setAuthor(author, "").call()
                commitInfo(git)
            }
        }
    }

    /** Opens the bare repo directly — read-only ops (content, log, diff, tree-walk). */
    private fun openBare(teamId: Long): Git {
        val bareDir = bareRepoPath(teamId).toFile()
        require(bareDir.resolve("HEAD").isFile) { "bare repo does not exist for team $teamId" }
        return Git.open(bareDir)
    }

    /** Clones bare → temp, runs [block], pushes new commits back, tears the clone down. */
    private fun <T> withWorktree(teamId: Long, block: (Git) -> T): T {
        val bareDir = bareRepoPath(teamId).toFile()
        require(bareDir.resolve("HEAD").isFile) { "bare repo does not exist for team $teamId" }
        val tmpDir = createTempDirectory("microteams-wt-${teamId}-")
        try {
            Git.cloneRepository()
                .setURI(bareDir.toURI().toString())
                .setDirectory(tmpDir.toFile())
                .call()
                .use {}
            Git.open(tmpDir.toFile()).use { git ->
                val result = block(git)
                if (git.remoteList().call().any { it.name == "origin" }) {
                    git.push().setRemote("origin").setPushAll().call()
                }
                return result
            }
        } finally {
            try {
                java.io.File(tmpDir.toString()).deleteRecursively()
            } catch (_: Exception) {}
        }
    }

    private fun commitInfo(git: Git): CommitInfo {
        val head =
            git.repository.resolve(Constants.HEAD)
                ?: throw IllegalStateException("no HEAD after commit")
        RevWalk(git.repository).use { walk ->
            return walk.parseCommit(head).toCommitInfo()
        }
    }

    private fun RevCommit.toCommitInfo() =
        CommitInfo(
            sha = id.name,
            message = shortMessage,
            author = authorIdent.name,
            timestamp = authorIdent.`when`.time,
        )

    private fun parserFor(repo: org.eclipse.jgit.lib.Repository, commit: RevCommit) =
        CanonicalTreeParser().apply { repo.newObjectReader().use { reset(it, commit.tree) } }

    // A fresh CanonicalTreeParser is empty — diff treats it as the empty tree.
    private fun emptyTree() = CanonicalTreeParser()

    private fun <T> ReentrantLock.useLock(block: () -> T): T {
        lock()
        try {
            return block()
        } finally {
            unlock()
        }
    }
}

class NoSuchFileException(path: String) :
    BaseError(HttpStatus.NOT_FOUND, "file not found in git: $path", mapOf("path" to path))

class NoSuchCommitException(sha: String) :
    BaseError(HttpStatus.NOT_FOUND, "commit not found: $sha", mapOf("sha" to sha))
