/*
 *  Description: Integration test for the team-document feature. Drives the
 *               /team/{id}/document endpoint (git-backed, no document table) through
 *               the full stack: tree / single file / history / diff via query
 *               flags, plus write / move / delete and the auth + path guards.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import kotlin.math.floor
import org.hamcrest.Matchers.containsString
import org.hamcrest.Matchers.greaterThanOrEqualTo
import org.json.JSONObject
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
@TestMethodOrder(OrderAnnotation::class)
class DocumentTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {

    lateinit var owner: UserCreatorService.CreateUserResponse
    lateinit var ownerToken: String
    lateinit var stranger: UserCreatorService.CreateUserResponse
    lateinit var strangerToken: String

    private var teamId: IdType = -1
    private lateinit var firstSha: String

    @BeforeAll
    fun prepare() {
        owner = userCreatorService.createUser()
        ownerToken = userCreatorService.login(owner.username, owner.password)
        stranger = userCreatorService.createUser()
        strangerToken = userCreatorService.login(stranger.username, stranger.password)
        val response =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"name":"Docs Team ${floor(Math.random() * 1e10).toLong()}"}""")
                )
                .andReturn()
        teamId = JSONObject(response.response.contentAsString).getLong("id")
    }

    private fun docs() = "/team/$teamId/document"

    private fun auth(token: String = ownerToken) =
        get(docs()).header("Authorization", "Bearer $token")

    @Test
    @Order(10)
    fun writeCreatesFile() {
        val response =
            mockMvc
                .perform(
                    put(docs())
                        .header("Authorization", "Bearer $ownerToken")
                        .param("path", "notes/hello.md")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("# Hello")
                )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.path").value("notes/hello.md"))
                .andExpect(jsonPath("$.isFolder").value(false))
                .andExpect(jsonPath("$.content").value("# Hello"))
                .andExpect(jsonPath("$.commitSha").isNotEmpty)
                .andReturn()
        firstSha = JSONObject(response.response.contentAsString).getString("commitSha")
    }

    @Test
    @Order(20)
    fun readFileWithContentFlag() {
        mockMvc
            .perform(auth().param("path", "notes/hello.md").param("content", "true"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.isFolder").value(false))
            .andExpect(jsonPath("$.content").value("# Hello"))
    }

    @Test
    @Order(21)
    fun readFileWithoutContentFlagOmitsContent() {
        mockMvc
            .perform(auth().param("path", "notes/hello.md"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.isFolder").value(false))
            .andExpect(jsonPath("$.content").doesNotExist())
    }

    @Test
    @Order(30)
    fun rootIsShallowByDefault() {
        // no path = root; without recursive, folders are listed but not expanded.
        mockMvc
            .perform(auth())
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.path").value(""))
            .andExpect(jsonPath("$.isFolder").value(true))
            .andExpect(jsonPath("$.children[0].path").value("notes"))
            .andExpect(jsonPath("$.children[0].isFolder").value(true))
            .andExpect(jsonPath("$.children[0].children").doesNotExist())
    }

    @Test
    @Order(31)
    fun rootRecursiveExpandsTheWholeTree() {
        mockMvc
            .perform(auth().param("recursive", "true"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.children[0].path").value("notes"))
            .andExpect(jsonPath("$.children[0].children[0].path").value("notes/hello.md"))
            .andExpect(jsonPath("$.children[0].children[0].isFolder").value(false))
    }

    @Test
    @Order(32)
    fun readingAFolderListsItsChildren() {
        mockMvc
            .perform(auth().param("path", "notes"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.path").value("notes"))
            .andExpect(jsonPath("$.isFolder").value(true))
            .andExpect(jsonPath("$.children[0].path").value("notes/hello.md"))
    }

    @Test
    @Order(40)
    fun diffFlagShowsTheCommit() {
        mockMvc
            .perform(auth().param("path", "notes/hello.md").param("diff", firstSha))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.diff").value(containsString("Hello")))
    }

    @Test
    @Order(50)
    fun writeOverwritesAndHistoryFlagShowsBothCommits() {
        mockMvc
            .perform(
                put(docs())
                    .header("Authorization", "Bearer $ownerToken")
                    .param("path", "notes/hello.md")
                    .contentType(MediaType.TEXT_PLAIN)
                    .content("# Updated")
            )
            .andExpect(status().isOk)
        mockMvc
            .perform(auth().param("path", "notes/hello.md").param("content", "true"))
            .andExpect(jsonPath("$.content").value("# Updated"))
        mockMvc
            .perform(auth().param("path", "notes/hello.md").param("history", "true"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.history.length()", greaterThanOrEqualTo(2)))
    }

    @Test
    @Order(60)
    fun moveRenamesTheFile() {
        mockMvc
            .perform(
                patch(docs())
                    .header("Authorization", "Bearer $ownerToken")
                    .param("path", "notes/hello.md")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"newPath":"notes/renamed.md"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.path").value("notes/renamed.md"))
        mockMvc
            .perform(auth().param("path", "notes/renamed.md").param("content", "true"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.content").value("# Updated"))
    }

    @Test
    @Order(70)
    fun readingAMissingFileIs404() {
        mockMvc
            .perform(auth().param("path", "notes/hello.md").param("content", "true"))
            .andExpect(status().isNotFound)
    }

    @Test
    @Order(80)
    fun pathTraversalIsRejected() {
        mockMvc.perform(auth().param("path", "/etc/passwd")).andExpect(status().isBadRequest)
        mockMvc.perform(auth().param("path", "../../etc/passwd")).andExpect(status().isBadRequest)
    }

    @Test
    @Order(90)
    fun strangerCannotAccessDocuments() {
        mockMvc.perform(auth(strangerToken)).andExpect(status().isForbidden)
        mockMvc
            .perform(
                put(docs())
                    .header("Authorization", "Bearer $strangerToken")
                    .param("path", "evil.md")
                    .contentType(MediaType.TEXT_PLAIN)
                    .content("nope")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(91)
    fun anonymousIsUnauthorized() {
        mockMvc.perform(get(docs())).andExpect(status().isUnauthorized)
    }

    @Test
    @Order(99)
    fun deleteRemovesFile() {
        mockMvc
            .perform(
                delete(docs())
                    .header("Authorization", "Bearer $ownerToken")
                    .param("path", "notes/renamed.md")
            )
            .andExpect(status().isNoContent)
        // the only file is gone, so the root has no children.
        mockMvc
            .perform(auth())
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.children.length()").value(0))
    }
}
