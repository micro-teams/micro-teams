/*
 *  Description: Integration test for the team feature. Drives the /teams
 *               endpoints through the full servlet + auth + JPA stack, with
 *               real users created via cheese-auth.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.api

import kotlin.math.floor
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
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@AutoConfigureMockMvc
@TestMethodOrder(OrderAnnotation::class)
class TeamTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {

    lateinit var owner: UserCreatorService.CreateUserResponse
    lateinit var ownerToken: String
    lateinit var member: UserCreatorService.CreateUserResponse
    lateinit var memberToken: String
    lateinit var stranger: UserCreatorService.CreateUserResponse
    lateinit var strangerToken: String

    private val teamName = "Test Team ${floor(Math.random() * 1e10).toLong()}"
    private var teamId: IdType = -1

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
    fun createTeam() {
        val response =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType("application/json")
                        .content("""{"name":"$teamName"}""")
                )
                .andExpect(status().isCreated)
                .andExpect(jsonPath("$.id").isNumber)
                .andExpect(jsonPath("$.name").value(teamName))
                .andReturn()
        teamId = JSONObject(response.response.contentAsString).getLong("id")
    }

    @Test
    @Order(20)
    fun getTeamShowsOwnerMembership() {
        mockMvc
            .perform(get("/team/$teamId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.team.id").value(teamId))
            .andExpect(jsonPath("$.team.name").value(teamName))
            .andExpect(jsonPath("$.members[0].userId").value(owner.userId))
            .andExpect(jsonPath("$.members[0].role").value("OWNER"))
    }

    @Test
    @Order(21)
    fun listMyTeamsIsPaginated() {
        // A freshly-created user owns exactly this one team.
        mockMvc
            .perform(get("/team").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.teams[0].id").value(teamId))
            .andExpect(jsonPath("$.teams[0].name").value(teamName))
            .andExpect(jsonPath("$.page.page_size").value(1))
            .andExpect(jsonPath("$.page.has_more").value(false))
    }

    @Test
    @Order(22)
    fun listMyTeamsFiltersByRole() {
        // caller is OWNER of the team → OWNER filter keeps it, MEMBER filter drops it.
        mockMvc
            .perform(
                get("/team").header("Authorization", "Bearer $ownerToken").param("role", "OWNER")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.teams[0].id").value(teamId))
        mockMvc
            .perform(
                get("/team").header("Authorization", "Bearer $ownerToken").param("role", "MEMBER")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.teams.length()").value(0))
        mockMvc
            .perform(
                get("/team").header("Authorization", "Bearer $ownerToken").param("role", "BOGUS")
            )
            .andExpect(status().isBadRequest)
    }

    @Test
    @Order(30)
    fun strangerCannotReadTeam() {
        mockMvc
            .perform(get("/team/$teamId").header("Authorization", "Bearer $strangerToken"))
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(31)
    fun anonymousIsUnauthorized() {
        mockMvc.perform(get("/team/$teamId")).andExpect(status().isUnauthorized)
    }

    @Test
    @Order(40)
    fun ownerAddsMember() {
        mockMvc
            .perform(
                post("/team/$teamId/members")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"userId":${member.userId},"role":"MEMBER"}""")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(get("/team/$teamId/members").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(2))
    }

    @Test
    @Order(41)
    fun memberCanNowReadTeam() {
        mockMvc
            .perform(get("/team/$teamId").header("Authorization", "Bearer $memberToken"))
            .andExpect(status().isOk)
    }

    @Test
    @Order(50)
    fun ordinaryMemberCannotAddMembers() {
        // update on team requires admin+.
        mockMvc
            .perform(
                post("/team/$teamId/members")
                    .header("Authorization", "Bearer $memberToken")
                    .contentType("application/json")
                    .content("""{"userId":${stranger.userId},"role":"MEMBER"}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(51)
    fun ownerPromotesMemberToAdmin() {
        mockMvc
            .perform(
                patch("/team/$teamId/members/${member.userId}")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"role":"ADMIN"}""")
            )
            .andExpect(status().isNoContent)
    }

    @Test
    @Order(52)
    fun adminCanAddAndRemoveMembersCleanly() {
        fun addStranger() =
            mockMvc
                .perform(
                    post("/team/$teamId/members")
                        .header("Authorization", "Bearer $memberToken")
                        .contentType("application/json")
                        .content("""{"userId":${stranger.userId},"role":"MEMBER"}""")
                )
                .andExpect(status().isNoContent)
        fun removeStranger() =
            mockMvc
                .perform(
                    delete("/team/$teamId/members/${stranger.userId}")
                        .header("Authorization", "Bearer $ownerToken")
                )
                .andExpect(status().isNoContent)
        fun memberCount(expected: Int) =
            mockMvc
                .perform(get("/team/$teamId/members").header("Authorization", "Bearer $ownerToken"))
                .andExpect(jsonPath("$.length()").value(expected))

        // admin (the promoted member) can add; owner + member + stranger = 3.
        addStranger()
        memberCount(3)
        // hard delete → back to 2.
        removeStranger()
        memberCount(2)
        // re-adding after a remove must be clean: 3 again, not 4 (no stale row).
        addStranger()
        memberCount(3)
        removeStranger()
        memberCount(2)
    }

    @Test
    @Order(60)
    fun renameTeam() {
        mockMvc
            .perform(
                patch("/team/$teamId")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"name":"$teamName (renamed)"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.name").value("$teamName (renamed)"))
    }

    @Test
    @Order(70)
    fun adminCannotDeleteTeam() {
        // delete is owner-only ("owned" predicate); the member is an admin now.
        mockMvc
            .perform(delete("/team/$teamId").header("Authorization", "Bearer $memberToken"))
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(90)
    fun ownerDeletesTeam() {
        mockMvc
            .perform(delete("/team/$teamId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isNoContent)
    }
}
