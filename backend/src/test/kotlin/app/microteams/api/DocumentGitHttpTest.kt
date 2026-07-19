/*
 *  Description: End-to-end test for the git smart-HTTP document remote. A team member clones the
 *               team's document tree over HTTP with their token, commits a file, and pushes — and
 *               the commit must land in the bare repo (readable back through GitService, the same
 *               store the human /team/{id}/document endpoints read). A non-member cloning the same
 *               repo is refused. This proves the transport, the RepositoryResolver, and that the
 *               auth filter reuses the ordinary read/write-document matrix rather than a second path.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

package app.microteams.api

import app.microteams.team.documents.GitService
import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.TransportConfigCallback
import org.eclipse.jgit.transport.TransportHttp
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DocumentGitHttpTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    private val userCreatorService: UserCreatorService,
    private val gitService: GitService,
) {
    @LocalServerPort private var port: Int = 0

    private lateinit var memberToken: String
    private lateinit var strangerToken: String
    private var teamId: Long = -1

    @BeforeAll
    fun prepare() {
        val member = userCreatorService.createUser()
        memberToken = userCreatorService.login(member.username, member.password)
        val stranger = userCreatorService.createUser()
        strangerToken = userCreatorService.login(stranger.username, stranger.password)
        teamId = createTeam(memberToken, "Docs ${UUID.randomUUID().toString().take(6)}")
    }

    private fun createTeam(token: String, name: String): Long {
        val res =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $token")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    private fun bearer(token: String): TransportConfigCallback =
        TransportConfigCallback { transport ->
            if (transport is TransportHttp) {
                transport.setAdditionalHeaders(mapOf("Authorization" to "Bearer $token"))
            }
        }

    private fun repoUri() = "http://localhost:$port/git/$teamId"

    @Test
    fun memberClonesCommitsAndPushes() {
        val dir = Files.createTempDirectory("git-http-clone").toFile()
        Git.cloneRepository()
            .setURI(repoUri())
            .setDirectory(dir)
            .setTransportConfigCallback(bearer(memberToken))
            .call()
            .use { git ->
                File(dir, "notes/hello.md").also { it.parentFile.mkdirs() }.writeText("# hi\n")
                git.add().addFilepattern("notes/hello.md").call()
                git.commit()
                    .setMessage("agent adds a doc")
                    .setAuthor("Agent", "agent@microteams.test")
                    .call()
                git.push().setTransportConfigCallback(bearer(memberToken)).call()
            }

        // The pushed file is now in the bare repo's HEAD — the same store humans read.
        assertEquals("# hi\n", gitService.getContent(teamId, "notes/hello.md"))
    }

    @Test
    fun nonMemberIsRefused() {
        val dir = Files.createTempDirectory("git-http-deny").toFile()
        assertThrows(Exception::class.java) {
            Git.cloneRepository()
                .setURI(repoUri())
                .setDirectory(dir)
                .setTransportConfigCallback(bearer(strangerToken))
                .call()
                .close()
        }
    }

    @Test
    fun tokenlessCloneIsRefused() {
        val dir = Files.createTempDirectory("git-http-anon").toFile()
        assertThrows(Exception::class.java) {
            Git.cloneRepository().setURI(repoUri()).setDirectory(dir).call().close()
        }
    }
}
