/*
 *  Description: Unit tests for GitService — every test uses a temporary
 *               directory as repoBase, initializes a bare repo, and cleans
 *               up afterward.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

package app.microteams.team.documents

import java.nio.file.Files
import java.nio.file.Paths
import kotlin.io.path.createTempDirectory
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class GitServiceTest {

    private lateinit var svc: GitService
    private lateinit var tmpDir: java.nio.file.Path
    private val teamId = 1L

    @BeforeEach
    fun setUp() {
        tmpDir = createTempDirectory("git-service-test-")
        svc = GitService()
        svc.repoBase = tmpDir.toString()
    }

    @AfterEach
    fun tearDown() {
        java.io.File(tmpDir.toString()).deleteRecursively()
    }

    @Test
    fun `initBareRepo creates a bare repository`() {
        svc.initBareRepo(teamId)
        val head = Paths.get(tmpDir.toString(), "$teamId.git", "HEAD")
        assertTrue(Files.isRegularFile(head), "HEAD file should exist")
    }

    @Test
    fun `initBareRepo is idempotent`() {
        svc.initBareRepo(teamId)
        svc.initBareRepo(teamId) // second call should not throw
    }

    @Test
    fun `createDocument commits and returns info`() {
        svc.initBareRepo(teamId)
        val commit = svc.createDocument(teamId, "readme.md", "# Hello", "alice")
        assertNotNull(commit.sha)
        assertEquals("create: readme.md", commit.message)
        assertEquals("alice", commit.author)
        assertTrue(commit.timestamp > 0)
    }

    @Test
    fun `getContent reads committed content back`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "a.txt", "hello world", "alice")
        assertEquals("hello world", svc.getContent(teamId, "a.txt"))
    }

    @Test
    fun `updateDocument changes content`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "doc.txt", "v1", "alice")
        svc.updateDocument(teamId, "doc.txt", "v2", "bob")
        assertEquals("v2", svc.getContent(teamId, "doc.txt"))
    }

    @Test
    fun `deleteDocument removes file`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "temp.txt", "gone", "alice")
        svc.deleteDocument(teamId, "temp.txt", "alice")
        assertThrows(NoSuchFileException::class.java) { svc.getContent(teamId, "temp.txt") }
    }

    @Test
    fun `moveDocument renames file`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "old.md", "move me", "alice")
        svc.moveDocument(teamId, "old.md", "new.md", "alice")
        assertEquals("move me", svc.getContent(teamId, "new.md"))
        assertThrows(NoSuchFileException::class.java) { svc.getContent(teamId, "old.md") }
    }

    @Test
    fun `getHistory lists commits for a file`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "log.txt", "initial", "alice")
        svc.updateDocument(teamId, "log.txt", "updated", "bob")
        val history = svc.getHistory(teamId, "log.txt")
        assertEquals(2, history.size)
    }

    @Test
    fun `getDiff returns a patch for a commit`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "diff.txt", "line1\nline2", "alice")
        svc.updateDocument(teamId, "diff.txt", "line1\nline3", "bob")
        val history = svc.getHistory(teamId, "diff.txt")
        val latest = history.first()
        val diff = svc.getDiff(teamId, latest.sha)
        assertTrue(diff.isNotEmpty())
        assertTrue(diff.contains("line2") || diff.contains("line3"))
    }

    @Test
    fun `refreshIndex lists all files in HEAD`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "f1.md", "one", "alice")
        svc.createDocument(teamId, "f2.md", "two", "alice")
        val entries = svc.refreshIndex(teamId)
        assertEquals(2, entries.size)
        val paths = entries.map { it.path }.toSet()
        assertTrue(paths.contains("f1.md"))
        assertTrue(paths.contains("f2.md"))
    }

    @Test
    fun `headCommit returns latest HEAD sha`() {
        svc.initBareRepo(teamId)
        assertNotNull(svc.headCommit(teamId)) // the empty seed commit
        svc.createDocument(teamId, "x.txt", "body", "alice")
        val sha = svc.headCommit(teamId)
        assertNotNull(sha)
        assertEquals(40, sha!!.length)
    }

    @Test
    fun `createDocument with subdirectory path`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "sub/dir/file.txt", "nested", "alice")
        assertEquals("nested", svc.getContent(teamId, "sub/dir/file.txt"))
    }

    @Test
    fun `getContent throws for nonexistent file`() {
        svc.initBareRepo(teamId)
        svc.createDocument(teamId, "real.txt", "ok", "alice")
        assertThrows(NoSuchFileException::class.java) { svc.getContent(teamId, "nope.txt") }
    }

    @Test
    fun `concurrent writes do not corrupt`() {
        svc.initBareRepo(teamId)
        val jobs =
            (1..10).map { i ->
                Thread { svc.createDocument(teamId, "concurrent-$i.md", "body-$i", "user-$i") }
            }
        jobs.forEach { it.start() }
        jobs.forEach { it.join() }
        val entries = svc.refreshIndex(teamId)
        assertEquals(10, entries.size)
    }
}
