/*
 *  Description: This file implements the DocumentService class. Documents live in
 *               each team's git repository (no database table); this service shapes
 *               the flat git tree GitService returns into a nested Document model and
 *               performs the write operations (create/overwrite/move/delete) as git
 *               commits. GitService is this package's storage engine — documents ARE
 *               git — so it lives here rather than in a module of its own; membership's
 *               createTeam reaches in for initBareRepo, its one cross-feature use.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team.documents

import app.microteams.model.DocCommitDTO
import app.microteams.model.DocNodeDTO
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

/** GitService's commit -> the API's DocCommit (git types stay internal to this package). */
private fun CommitInfo.toDTO() =
    DocCommitDTO(sha = sha, message = message, author = author, timestamp = timestamp)

@Service
class DocumentService(private val gitService: GitService) {

    /**
     * Returns the document at [path] (or the repo root when [path] is empty).
     * - a folder/root carries [DocNodeDTO.children] — the whole subtree when [recursive], otherwise
     *   just its immediate entries (folders left unexpanded for lazy loading);
     * - a file carries [DocNodeDTO.content] when [withContent];
     * - [withHistory] adds the git log for the path, [diffSha] adds that commit's diff.
     */
    fun getDocument(
        teamId: IdType,
        path: String,
        recursive: Boolean,
        withContent: Boolean,
        withHistory: Boolean,
        diffSha: String?,
    ): DocNodeDTO {
        val entries = gitService.refreshIndex(teamId)
        val history =
            if (withHistory && path.isNotEmpty())
                gitService.getHistory(teamId, path).map { it.toDTO() }
            else null
        val diff = diffSha?.let { gitService.getDiff(teamId, it) }

        val fileEntry = if (path.isNotEmpty()) entries.find { it.path == path } else null
        if (fileEntry != null) {
            return DocNodeDTO(
                path = path,
                isFolder = false,
                commitSha = fileEntry.commitSha,
                content = if (withContent) gitService.getContent(teamId, path) else null,
                history = history,
                diff = diff,
            )
        }

        val under = if (path.isEmpty()) entries else entries.filter { it.path.startsWith("$path/") }
        if (path.isNotEmpty() && under.isEmpty()) throw NoSuchFileException(path)
        return DocNodeDTO(
            path = path,
            isFolder = true,
            children = buildTree(strip(under, path), path, recursive),
            history = history,
            diff = diff,
        )
    }

    /** Create or overwrite a file (idempotent for identical content). */
    fun writeDocument(teamId: IdType, path: String, content: String, authorId: IdType): DocNodeDTO {
        val commit = gitService.updateDocument(teamId, path, content, "user-$authorId")
        return DocNodeDTO(path = path, isFolder = false, commitSha = commit.sha, content = content)
    }

    fun moveDocument(teamId: IdType, from: String, to: String, authorId: IdType): DocNodeDTO {
        val commit = gitService.moveDocument(teamId, from, to, "user-$authorId")
        return DocNodeDTO(
            path = to,
            isFolder = false,
            commitSha = commit.sha,
            content = gitService.getContent(teamId, to),
        )
    }

    fun deleteDocument(teamId: IdType, path: String, authorId: IdType) {
        gitService.deleteDocument(teamId, path, "user-$authorId")
    }

    // -- tree construction -------------------------------------------------

    private fun join(prefix: String, name: String) = if (prefix.isEmpty()) name else "$prefix/$name"

    /** Re-roots [entries] so their paths are relative to [prefix]. */
    private fun strip(entries: List<TreeEntry>, prefix: String): List<TreeEntry> =
        if (prefix.isEmpty()) entries
        else entries.map { it.copy(path = it.path.removePrefix("$prefix/")) }

    private fun buildTree(
        entries: List<TreeEntry>,
        prefix: String,
        recursive: Boolean,
    ): List<DocNodeDTO> {
        val files = mutableListOf<DocNodeDTO>()
        val dirs = linkedMapOf<String, MutableList<TreeEntry>>()
        for (e in entries) {
            val slash = e.path.indexOf('/')
            if (slash < 0) {
                files.add(
                    DocNodeDTO(join(prefix, e.path), isFolder = false, commitSha = e.commitSha)
                )
            } else {
                val dirName = e.path.substring(0, slash)
                dirs
                    .getOrPut(dirName) { mutableListOf() }
                    .add(e.copy(path = e.path.substring(slash + 1)))
            }
        }
        val folders =
            dirs.map { (dirName, children) ->
                val full = join(prefix, dirName)
                DocNodeDTO(
                    path = full,
                    isFolder = true,
                    children = if (recursive) buildTree(children, full, true) else null,
                )
            }
        return folders + files
    }
}
