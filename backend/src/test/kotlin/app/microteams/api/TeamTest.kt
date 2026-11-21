/*
 *  Description: Integration test for teams as trust groups: members have no roles, anyone who
 *               can access a team may add and remove people in it, anyone may leave, a team inside
 *               another is accessible to the outer team's members (transitively) without their
 *               being members, nesting needs access to both teams and refuses cycles, and the team
 *               picker (GET /team) lists only memberships.
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
import org.springframework.http.MediaType
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
class TeamTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {
    private lateinit var ann: String
    private lateinit var bob: String
    private lateinit var cat: String
    private var annId: IdType = -1
    private var bobId: IdType = -1
    private var catId: IdType = -1
    private var root: IdType = -1
    private var task: IdType = -1
    private var leaf: IdType = -1
    private var bobs: IdType = -1

    @BeforeAll
    fun prepare() {
        val a = userCreatorService.createUser()
        val b = userCreatorService.createUser()
        val c = userCreatorService.createUser()
        ann = userCreatorService.login(a.username, a.password)
        bob = userCreatorService.login(b.username, b.password)
        cat = userCreatorService.login(c.username, c.password)
        annId = a.userId
        bobId = b.userId
        catId = c.userId
    }

    private fun MockHttpServletRequestDsl.auth(token: String, body: String? = null) {
        header("Authorization", "Bearer $token")
        if (body != null) {
            contentType = MediaType.APPLICATION_JSON
            content = body
        }
    }

    private fun id(r: ResultActionsDsl) =
        JSONObject(r.andReturn().response.contentAsString).getLong("id")

    @Test
    @Order(10)
    fun theCreatorIsTheFirstMember() {
        root =
            id(
                mockMvc
                    .post("/team") { auth(ann, """{"name":"root"}""") }
                    .andExpect { status { isCreated() } },
            )
        mockMvc
            .get("/team/$root") { auth(ann) }
            .andExpect {
                status { isOk() }
                jsonPath("$.members[0].userId") { value(annId) }
                jsonPath("$.isMember") { value(true) }
            }
        mockMvc.get("/team/$root") { auth(bob) }.andExpect { status { isForbidden() } }
        mockMvc.get("/team/$root") {}.andExpect { status { isUnauthorized() } }
    }

    @Test
    @Order(20)
    fun anyMemberAddsAndRemovesAndAnyoneLeaves() {
        mockMvc
            .post("/team/$root/members") { auth(ann, """{"userId":$bobId}""") }
            .andExpect { status { isNoContent() } }
        // Bob has no role, and needs none to add Cat.
        mockMvc
            .post("/team/$root/members") { auth(bob, """{"userId":$catId}""") }
            .andExpect { status { isNoContent() } }
        mockMvc
            .patch("/team/$root") { auth(cat, """{"name":"root renamed"}""") }
            .andExpect { status { isOk() } }
        mockMvc
            .delete("/team/$root/members/$catId") { auth(cat) }
            .andExpect { status { isNoContent() } }
        mockMvc.get("/team/$root") { auth(cat) }.andExpect { status { isForbidden() } }
        // Cat, outside, cannot remove anyone.
        mockMvc
            .delete("/team/$root/members/$bobId") { auth(cat) }
            .andExpect { status { isForbidden() } }
    }

    @Test
    @Order(30)
    fun aTeamInsideAnotherIsAccessibleToTheOuterTeamTransitively() {
        task =
            id(
                mockMvc
                    .post("/team") { auth(ann, """{"name":"task","parentId":$root}""") }
                    .andExpect { status { isCreated() } },
            )
        mockMvc
            .post("/team/$task/members") { auth(ann, """{"userId":$catId}""") }
            .andExpect { status { isNoContent() } }
        leaf =
            id(
                mockMvc
                    .post("/team") { auth(cat, """{"name":"leaf","parentId":$task}""") }
                    .andExpect { status { isCreated() } },
            )

        // Bob is a member of root only, and reaches the leaf two levels down without joining it.
        mockMvc
            .get("/team/$leaf") { auth(bob) }
            .andExpect {
                status { isOk() }
                jsonPath("$.isMember") { value(false) }
                jsonPath("$.parents[0].id") { value(task) }
            }
        mockMvc
            .get("/team/$root") { auth(bob) }
            .andExpect { jsonPath("$.subteams[0].id") { value(task) } }
        // Trust goes down, not up: Cat, in task, cannot see root.
        mockMvc.get("/team/$root") { auth(cat) }.andExpect { status { isForbidden() } }
        // The picker lists memberships only.
        mockMvc.get("/team") { auth(bob) }.andExpect { jsonPath("$.teams.length()") { value(1) } }
    }

    @Test
    @Order(40)
    fun nestingNeedsBothTeamsAndRefusesCycles() {
        bobs =
            id(
                mockMvc
                    .post("/team") { auth(bob, """{"name":"bob's"}""") }
                    .andExpect { status { isCreated() } },
            )
        // Cat can access leaf but not bob's team: she cannot nest one in the other either way.
        mockMvc
            .post("/team/$leaf/subteams") { auth(cat, """{"teamId":$bobs}""") }
            .andExpect { status { isForbidden() } }
        mockMvc
            .post("/team/$bobs/subteams") { auth(cat, """{"teamId":$leaf}""") }
            .andExpect { status { isForbidden() } }
        // Bob can access both.
        mockMvc
            .post("/team/$bobs/subteams") { auth(bob, """{"teamId":$leaf}""") }
            .andExpect { status { isNoContent() } }
        // Root contains leaf; putting root inside leaf would make a cycle.
        mockMvc
            .post("/team/$leaf/subteams") { auth(bob, """{"teamId":$root}""") }
            .andExpect { status { isBadRequest() } }
        // A subteam cannot take itself out of its parent: the edge is the parent's.
        mockMvc
            .delete("/team/$task/subteams/$leaf") { auth(bob) }
            .andExpect { status { isNoContent() } }
        mockMvc
            .delete("/team/$bobs/subteams/$leaf") { auth(cat) }
            .andExpect { status { isForbidden() } }
    }

    @Test
    @Order(50)
    fun anyoneWhoCanAccessATeamMayDeleteIt() {
        mockMvc.delete("/team/$bobs") { auth(bob) }.andExpect { status { isNoContent() } }
        mockMvc.get("/team/$leaf") { auth(bob) }.andExpect { status { isForbidden() } }
    }
}
