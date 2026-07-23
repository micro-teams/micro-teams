/*
 *  Description: Tests for the shared driver shell helpers. shellQuote is checked as a pure function;
 *               enterCwd is exercised through a real bash (like GitServiceTest uses real JGit) to
 *               prove a leading `~` is expanded to $HOME and the directory is created and entered.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.driver

import java.io.File
import java.nio.file.Files
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DriverShellTest {
    @Test
    fun shellQuoteWrapsAndEscapesSingleQuotes() {
        assertEquals("'plain'", shellQuote("plain"))
        assertEquals("'a'\\''b'", shellQuote("a'b"))
    }

    @Test
    fun enterCwdExpandsLeadingTildeAndCreatesTheDir() {
        val home = Files.createTempDirectory("mt-home").toFile()
        try {
            // A fake HOME lets us assert ~ expansion without touching the real home directory.
            val out = bash(enterCwd("~/work/repo") + "pwd", home)
            assertEquals("${home.path}/work/repo", out)
            assertTrue(File(home, "work/repo").isDirectory, "the dir should have been created")
        } finally {
            home.deleteRecursively()
        }
    }

    @Test
    fun enterCwdLeavesAbsolutePathsAlone() {
        val dir = Files.createTempDirectory("mt-abs").toFile()
        try {
            val out = bash(enterCwd(dir.path) + "pwd", File("/nonexistent-home"))
            assertEquals(dir.path, out)
        } finally {
            dir.deleteRecursively()
        }
    }

    private fun bash(script: String, home: File): String {
        val pb = ProcessBuilder("bash", "-c", script)
        pb.environment()["HOME"] = home.path
        pb.redirectErrorStream(true)
        val p = pb.start()
        val out = p.inputStream.bufferedReader().use { it.readText() }.trim()
        p.waitFor()
        return out
    }
}
