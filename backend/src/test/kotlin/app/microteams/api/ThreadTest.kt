/*
 *  Description: Integration test for chats: a thread in no team is its members' alone; a thread
 *               in a team is readable by whoever can access the team, who may join it; speaking
 *               needs membership; members have no roles; joining and leaving are written into the
 *               thread as JOINED and LEFT lines.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

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
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockHttpServletRequestDsl
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
@TestMethodOrder(OrderAnnotation::class)
class ThreadTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {
    private lateinit var ann: String
    private lateinit var bob: String
    private lateinit var cat: String
    private var bobId: IdType = -1
    private var catId: IdType = -1
    private var direct: IdType = -1
    private var teamId: IdType = -1
    private var teamChat: IdType = -1

    @BeforeAll
    fun prepare() {
        val a = userCreatorService.createUser()
        val b = userCreatorService.createUser()
        val c = userCreatorService.createUser()
        ann = userCreatorService.login(a.username, a.password)
        bob = userCreatorService.login(b.username, b.password)
        cat = userCreatorService.login(c.username, c.password)
        bobId = b.userId
        catId = c.userId
    }

    private fun MockHttpServletRequestDsl.auth(token: String, body: String? = null) {
        header("Authorization", "Bearer $token")
        if (body != null) {
            contentType = org.springframework.http.MediaType.APPLICATION_JSON
            content = body
        }
    }

    private fun json(r: ResultActionsDsl) = JSONObject(r.andReturn().response.contentAsString)

    @Test
    @Order(10)
    fun aThreadInNoTeamIsItsMembersAlone() {
        direct =
            json(
                    mockMvc
                        .post("/chat") { auth(ann, """{"title":"direct","memberIds":[$bobId]}""") }
                        .andExpect { status { isCreated() } },
                )
                .getLong("id")
        mockMvc
            .get("/chat/$direct") { auth(bob) }
            .andExpect {
                status { isOk() }
                jsonPath("$.isMember") { value(true) }
            }
        mockMvc.get("/chat/$direct") { auth(cat) }.andExpect { status { isForbidden() } }
        mockMvc.get("/chat/$direct/messages") { auth(cat) }.andExpect { status { isForbidden() } }
        mockMvc.post("/chat/$direct/join") { auth(cat) }.andExpect { status { isForbidden() } }
    }

    @Test
    @Order(20)
    fun everyMemberMaySpeakRenameAndAdd() {
        mockMvc
            .post("/chat/$direct/messages") { auth(bob, """{"content":"hello"}""") }
            .andExpect { status { isCreated() } }
        mockMvc
            .patch("/chat/$direct") { auth(bob, """{"title":"renamed by bob"}""") }
            .andExpect { status { isOk() } }
        mockMvc
            .post("/chat/$direct/members") { auth(bob, """{"userId":$catId}""") }
            .andExpect { status { isNoContent() } }
        mockMvc
            .get("/chat/$direct/messages") { auth(cat) }
            .andExpect {
                status { isOk() }
                jsonPath("$.messages[0].kind") { value("TEXT") }
                jsonPath("$.messages[0].content") { value("hello") }
                jsonPath("$.messages[1].kind") { value("JOINED") }
                jsonPath("$.messages[1].senderId") { value(catId) }
            }
    }

    @Test
    @Order(30)
    fun leavingIsWrittenIntoTheThread() {
        mockMvc
            .delete("/chat/$direct/members/$catId") { auth(cat) }
            .andExpect { status { isNoContent() } }
        mockMvc
            .get("/chat/$direct/messages") { auth(ann) }
            .andExpect { jsonPath("$.messages[2].kind") { value("LEFT") } }
        mockMvc
            .post("/chat/$direct/messages") { auth(cat, """{"content":"still here?"}""") }
            .andExpect { status { isForbidden() } }
    }

    @Test
    @Order(40)
    fun aTeamsThreadIsReadableByTheTeamAndJoinable() {
        teamId =
            json(
                    mockMvc
                        .post("/team") { auth(ann, """{"name":"chat team"}""") }
                        .andExpect { status { isCreated() } },
                )
                .getLong("id")
        mockMvc
            .post("/team/$teamId/members") { auth(ann, """{"userId":$catId}""") }
            .andExpect { status { isNoContent() } }
        teamChat =
            json(
                    mockMvc
                        .post("/team/$teamId/chats") { auth(ann, """{"title":"general"}""") }
                        .andExpect { status { isOk() } },
                )
                .getLong("id")

        // Cat can access the team, so reads the thread without being a member, and is told so.
        mockMvc
            .get("/chat/$teamChat") { auth(cat) }
            .andExpect {
                status { isOk() }
                jsonPath("$.isMember") { value(false) }
                jsonPath("$.teams[0].id") { value(teamId) }
            }
        mockMvc
            .get("/team/$teamId/chats") { auth(cat) }
            .andExpect {
                jsonPath("$.chats[0].id") { value(teamChat) }
                jsonPath("$.chats[0].isMember") { value(false) }
            }
        // Reading is not speaking.
        mockMvc
            .post("/chat/$teamChat/messages") { auth(cat, """{"content":"hi"}""") }
            .andExpect { status { isForbidden() } }
        mockMvc.post("/chat/$teamChat/join") { auth(cat) }.andExpect { status { isNoContent() } }
        mockMvc
            .post("/chat/$teamChat/messages") { auth(cat, """{"content":"hi"}""") }
            .andExpect { status { isCreated() } }
        // Bob is outside the team: nothing to read, nothing to join.
        mockMvc.get("/chat/$teamChat") { auth(bob) }.andExpect { status { isForbidden() } }
        mockMvc.post("/chat/$teamChat/join") { auth(bob) }.andExpect { status { isForbidden() } }
    }

    @Test
    @Order(50)
    fun aThreadIsPutIntoATeamOnlyByWhoeverCanReadIt() {
        // Cat can access the team but cannot read the direct thread (she left it).
        mockMvc
            .post("/team/$teamId/chats") { auth(cat, """{"threadId":$direct}""") }
            .andExpect { status { isForbidden() } }
        mockMvc
            .post("/team/$teamId/chats") { auth(ann, """{"threadId":$direct}""") }
            .andExpect { status { isOk() } }
        mockMvc.get("/chat/$direct") { auth(cat) }.andExpect { status { isOk() } }
        mockMvc
            .delete("/team/$teamId/chats/$direct") { auth(cat) }
            .andExpect { status { isNoContent() } }
        mockMvc.get("/chat/$direct") { auth(cat) }.andExpect { status { isForbidden() } }
    }

    @Test
    @Order(60)
    fun anyMemberMayDeleteTheThread() {
        mockMvc.delete("/chat/$teamChat") { auth(cat) }.andExpect { status { isNoContent() } }
    }
}
