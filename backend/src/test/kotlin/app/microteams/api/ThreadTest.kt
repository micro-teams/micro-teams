/*
 *  Description: Integration test for the chat feature. Drives the /chat and
 *               /chat/{id}/messages endpoints through the full stack — thread
 *               CRUD, membership, messages, pagination and the auth gates — with
 *               real users created via cheese-auth.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

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
class ThreadTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {

    lateinit var owner: UserCreatorService.CreateUserResponse
    lateinit var ownerToken: String
    lateinit var member: UserCreatorService.CreateUserResponse
    lateinit var memberToken: String
    lateinit var stranger: UserCreatorService.CreateUserResponse
    lateinit var strangerToken: String

    private var threadId: IdType = -1

    @BeforeAll
    fun prepare() {
        owner = userCreatorService.createUser()
        ownerToken = userCreatorService.login(owner.username, owner.password)
        member = userCreatorService.createUser()
        memberToken = userCreatorService.login(member.username, member.password)
        stranger = userCreatorService.createUser()
        strangerToken = userCreatorService.login(stranger.username, stranger.password)
    }

    @Test
    @Order(10)
    fun createThread() {
        val response =
            mockMvc
                .perform(
                    post("/chat")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""{"title":"Design chat"}""")
                )
                .andExpect(status().isCreated)
                .andExpect(jsonPath("$.id").isNumber)
                .andExpect(jsonPath("$.title").value("Design chat"))
                .andReturn()
        threadId = JSONObject(response.response.contentAsString).getLong("id")
    }

    @Test
    @Order(20)
    fun getThreadShowsOwnerMembership() {
        mockMvc
            .perform(get("/chat/$threadId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.thread.id").value(threadId))
            .andExpect(jsonPath("$.members[0].userId").value(owner.userId))
            .andExpect(jsonPath("$.members[0].role").value("OWNER"))
    }

    @Test
    @Order(21)
    fun listThreadsIsPaginated() {
        mockMvc
            .perform(get("/chat").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.chats[0].id").value(threadId))
            .andExpect(jsonPath("$.page.page_size").value(1))
            .andExpect(jsonPath("$.page.has_more").value(false))
    }

    @Test
    @Order(30)
    fun strangerCannotReadThread() {
        mockMvc
            .perform(get("/chat/$threadId").header("Authorization", "Bearer $strangerToken"))
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(31)
    fun anonymousIsUnauthorized() {
        mockMvc.perform(get("/chat/$threadId")).andExpect(status().isUnauthorized)
    }

    @Test
    @Order(40)
    fun ownerAddsMember() {
        mockMvc
            .perform(
                post("/chat/$threadId/members")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"userId":${member.userId},"role":"MEMBER"}""")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(get("/chat/$threadId/members").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(2))
    }

    @Test
    @Order(41)
    fun memberCanReadThread() {
        mockMvc
            .perform(get("/chat/$threadId").header("Authorization", "Bearer $memberToken"))
            .andExpect(status().isOk)
    }

    @Test
    @Order(50)
    fun ordinaryMemberCannotAddMembers() {
        mockMvc
            .perform(
                post("/chat/$threadId/members")
                    .header("Authorization", "Bearer $memberToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"userId":${stranger.userId},"role":"MEMBER"}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(60)
    fun memberPostsMessage() {
        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $memberToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"content":"hello team"}""")
            )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.content").value("hello team"))
            .andExpect(jsonPath("$.senderId").value(member.userId))
    }

    @Test
    @Order(61)
    fun listMessagesIsPaginated() {
        mockMvc
            .perform(get("/chat/$threadId/messages").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.messages[0].content").value("hello team"))
            .andExpect(jsonPath("$.page.page_size", greaterThanOrEqualTo(1)))
    }

    @Test
    @Order(62)
    fun strangerCannotPostMessage() {
        mockMvc
            .perform(
                post("/chat/$threadId/messages")
                    .header("Authorization", "Bearer $strangerToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"content":"intruder"}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(70)
    fun ordinaryMemberCannotRename() {
        mockMvc
            .perform(
                patch("/chat/$threadId")
                    .header("Authorization", "Bearer $memberToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"nope"}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(71)
    fun ownerRenamesThread() {
        mockMvc
            .perform(
                patch("/chat/$threadId")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"Design chat (renamed)"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.title").value("Design chat (renamed)"))
    }

    @Test
    @Order(80)
    fun promotedAdminCanRename() {
        mockMvc
            .perform(
                patch("/chat/$threadId/members/${member.userId}")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"role":"ADMIN"}""")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(
                patch("/chat/$threadId")
                    .header("Authorization", "Bearer $memberToken")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"Design chat (by admin)"}""")
            )
            .andExpect(status().isOk)
    }

    @Test
    @Order(85)
    fun adminCannotDissolveThread() {
        // dissolve is owner-only ("owned"); the member is an admin now.
        mockMvc
            .perform(delete("/chat/$threadId").header("Authorization", "Bearer $memberToken"))
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(90)
    fun ownerDissolvesThread() {
        mockMvc
            .perform(delete("/chat/$threadId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isNoContent)
    }
}
