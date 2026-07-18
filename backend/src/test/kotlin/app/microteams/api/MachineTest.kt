/*
 *  Description: Integration test for the machine enrollment flow and the symmetric,
 *               owner-less ownership model. Drives /machine and /team/{id}/machine through
 *               the full stack
 *               with real users created via cheese-auth.
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
class MachineTest
@Autowired
constructor(private val mockMvc: MockMvc, private val userCreatorService: UserCreatorService) {

    lateinit var owner: UserCreatorService.CreateUserResponse
    lateinit var ownerToken: String
    lateinit var stranger: UserCreatorService.CreateUserResponse
    lateinit var strangerToken: String

    private var team1: IdType = -1
    private var team2: IdType = -1
    private lateinit var enrollCode: String
    private lateinit var machineId: String

    @BeforeAll
    fun prepare() {
        owner = userCreatorService.createUser()
        ownerToken = userCreatorService.login(owner.username, owner.password)
        stranger = userCreatorService.createUser()
        strangerToken = userCreatorService.login(stranger.username, stranger.password)
        team1 = createTeam("Dev Team A ${rnd()}")
        team2 = createTeam("Dev Team B ${rnd()}")
    }

    private fun rnd() = floor(Math.random() * 1e10).toLong()

    private fun createTeam(name: String): IdType {
        val res =
            mockMvc
                .perform(
                    post("/team")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType("application/json")
                        .content("""{"name":"$name"}""")
                )
                .andExpect(status().isCreated)
                .andReturn()
        return JSONObject(res.response.contentAsString).getLong("id")
    }

    @Test
    @Order(10)
    fun startIsPublicAndReturnsCode() {
        val res =
            mockMvc
                .perform(
                    post("/machine/enroll/start")
                        .contentType("application/json")
                        .content("""{"name":"my-laptop"}""")
                )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.code").isNotEmpty)
                .andExpect(
                    jsonPath("$.approveUrl")
                        .value(org.hamcrest.Matchers.containsString("/connect?code="))
                )
                .andReturn()
        enrollCode = JSONObject(res.response.contentAsString).getString("code")
    }

    @Test
    @Order(20)
    fun pollBeforeApproveIsPending() {
        mockMvc
            .perform(
                post("/machine/enroll/poll")
                    .contentType("application/json")
                    .content("""{"code":"$enrollCode"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("pending"))
            .andExpect(jsonPath("$.token").doesNotExist())
    }

    @Test
    @Order(30)
    fun strangerCannotApproveToTeamTheyAreNotIn() {
        mockMvc
            .perform(
                post("/machine/enroll/approve")
                    .header("Authorization", "Bearer $strangerToken")
                    .contentType("application/json")
                    .content("""{"code":"$enrollCode","teamIds":[$team1]}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(40)
    fun ownerApprovesBindingToTeam1() {
        val res =
            mockMvc
                .perform(
                    post("/machine/enroll/approve")
                        .header("Authorization", "Bearer $ownerToken")
                        .contentType("application/json")
                        .content("""{"code":"$enrollCode","teamIds":[$team1]}""")
                )
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.id").isNotEmpty)
                .andExpect(jsonPath("$.name").value("my-laptop"))
                .andExpect(jsonPath("$.teamIds[0]").value(team1))
                .andReturn()
        machineId = JSONObject(res.response.contentAsString).getString("id")
    }

    @Test
    @Order(50)
    fun pollAfterApproveHandsBackToken() {
        mockMvc
            .perform(
                post("/machine/enroll/poll")
                    .contentType("application/json")
                    .content("""{"code":"$enrollCode"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("approved"))
            .andExpect(jsonPath("$.token").isNotEmpty)
            .andExpect(jsonPath("$.machineId").value(machineId))
    }

    @Test
    @Order(60)
    fun listedUnderTeam1NotTeam2() {
        mockMvc
            .perform(get("/machine?teamId=$team1").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.machines[0].id").value(machineId))
        mockMvc
            .perform(get("/machine?teamId=$team2").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.machines.length()").value(0))
    }

    @Test
    @Order(70)
    fun strangerCannotReadOrRename() {
        mockMvc
            .perform(get("/machine/$machineId").header("Authorization", "Bearer $strangerToken"))
            .andExpect(status().isForbidden)
        mockMvc
            .perform(
                patch("/machine/$machineId")
                    .header("Authorization", "Bearer $strangerToken")
                    .contentType("application/json")
                    .content("""{"name":"hacked"}""")
            )
            .andExpect(status().isForbidden)
    }

    @Test
    @Order(80)
    fun renameByAssociatedMember() {
        mockMvc
            .perform(
                patch("/machine/$machineId")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"name":"workstation"}""")
            )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.name").value("workstation"))
    }

    @Test
    @Order(90)
    fun shareToTeam2ThenBothList() {
        mockMvc
            .perform(
                post("/team/$team2/machine")
                    .header("Authorization", "Bearer $ownerToken")
                    .contentType("application/json")
                    .content("""{"machineId":"$machineId"}""")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(get("/machine/$machineId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.teamIds.length()").value(2))
        mockMvc
            .perform(get("/machine?teamId=$team2").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.machines[0].id").value(machineId))
    }

    @Test
    @Order(100)
    fun unshareTeam1KeepsTeam2() {
        mockMvc
            .perform(
                delete("/team/$team1/machine/$machineId")
                    .header("Authorization", "Bearer $ownerToken")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(get("/machine?teamId=$team1").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.machines.length()").value(0))
        mockMvc
            .perform(get("/machine/$machineId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.teamIds[0]").value(team2))
    }

    /**
     * Note the 403 rather than a 404: once the machine is forgotten nobody may access it, and the
     * permission matrix answers before the handler ever looks it up. That is a consequence of
     * authorization living entirely in the matrix, and a welcome one — it leaves no oracle for
     * probing which machine ids exist.
     */
    @Test
    @Order(110)
    fun unbindingLastTeamForgetsMachine() {
        mockMvc
            .perform(
                delete("/team/$team2/machine/$machineId")
                    .header("Authorization", "Bearer $ownerToken")
            )
            .andExpect(status().isNoContent)
        mockMvc
            .perform(get("/machine/$machineId").header("Authorization", "Bearer $ownerToken"))
            .andExpect(status().isForbidden)
    }
}
