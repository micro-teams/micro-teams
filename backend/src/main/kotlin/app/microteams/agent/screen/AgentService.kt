/*
 *  Description: AgentService — the orchestrator. It mints agent users (一个 agent 就是一个用户: a
 *               real User + UserProfile row, created directly the way UserCreatorService does,
 *               since mt does not own registration and an agent authenticates by machine+screen
 *               token, never a JWT), opens a screen for one on a machine through the driver of
 *               its choice, and registers it so chat can reach it.
 *
 *               Two things it deliberately no longer does. It does not forward chat: an agent is
 *               a ChatSubscriber (see AgentRegistry), so "who is in this group, and who wrote
 *               this" stays chat's question to answer rather than something the orchestrator
 *               reaches into chat's tables to work out. And it does not know what program runs on
 *               the screen — that is entirely the driver's (agent/driver).
 *
 *               This is the MVP slice of the reference orchestrator: it deliberately omits the
 *               read-watermark backlog, attention policies and triage lock (那些是「再完善」).
 *               "Being an agent" is derived from having a live screen — no flag.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.screen

import app.microteams.agent.AgentRegistry
import app.microteams.agent.driver.AgentDriver
import app.microteams.machine.enrollment.MachineService
import app.microteams.machine.link.MachineHub
import app.microteams.team.machine.TeamMachineService
import app.microteams.user.Avatar
import app.microteams.user.User
import app.microteams.user.UserProfile
import app.microteams.user.UserProfileRepository
import app.microteams.user.UserRepository
import at.favre.lib.crypto.bcrypt.BCrypt
import java.time.LocalDateTime
import java.util.UUID
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** The result of opening an agent: its user id and the screen now driving it. */
data class OpenedAgent(
    val agentUserId: IdType,
    val sid: String,
    val machineId: String,
    val screenToken: String,
)

@Service
class AgentService(
    private val hub: MachineHub,
    private val machineService: MachineService,
    private val teamMachineService: TeamMachineService,
    private val agentScreenRepository: AgentScreenRepository,
    private val agentRegistry: AgentRegistry,
    private val userRepository: UserRepository,
    private val userProfileRepository: UserProfileRepository,
    drivers: List<AgentDriver>,
    @Value("\${application.connector-origin:http://127.0.0.1:8080}")
    private val connectorOrigin: String,
    @Value("\${application.agent-email-domain:agents.microteams.local}")
    private val agentEmailDomain: String,
    @Value("\${application.default-agent-driver:claude}") private val defaultDriver: String,
) {
    private val logger = LoggerFactory.getLogger(AgentService::class.java)
    private val driversByName = drivers.associateBy { it.name }

    /**
     * Create an agent user and open its screen on [machineId], running in [teamId].
     *
     * Whether the caller may do this is not asked here — RolePermissionService's `open-agent` rule
     * has already been enforced by @Guard. What remains is a validity check, not a permission one:
     * a machine that does not serve the team cannot host its work at all, for anybody.
     */
    @Transactional
    fun openAgent(
        machineId: String,
        teamId: IdType,
        nickname: String?,
        cwd: String?,
        driverName: String?,
    ): OpenedAgent {
        if (!teamMachineService.servesTeam(machineId, teamId)) {
            throw BadRequestError("machine is not associated with team $teamId")
        }
        if (!hub.isOnline(machineId)) {
            throw BadRequestError("machine is not connected")
        }
        val wanted = driverName ?: defaultDriver
        val driver = driversByName[wanted] ?: throw BadRequestError("unknown driver: $wanted")

        val agentUserId = createAgentUser(nickname)
        val sessionId = UUID.randomUUID().toString() // we mint the program's session id
        // The screen's `microteams api` authenticates as this machine (MICROTEAMS_TOKEN) against
        // this server
        // (MICROTEAMS_API); paired with the per-screen MICROTEAMS_SCREEN the CLI injects, the
        // tool-door
        // attributes the call to this agent. We inject MICROTEAMS_TOKEN explicitly (the reference
        // relies on the machine's on-disk config token, but injecting is robust to a machine whose
        // default CLI config points elsewhere).
        val env = buildMap {
            put("MICROTEAMS_API", connectorOrigin)
            machineService.tokenOf(machineId)?.let { put("MICROTEAMS_TOKEN", it) }
        }
        val screen =
            hub.openScreen(
                machineId = machineId,
                command = driver.command(sessionId, cwd, resume = false),
                kind = AGENT_SCREEN_KIND,
                appletSource = driver.appletSource,
                env = env,
            )
        agentScreenRepository.save(
            AgentScreen(
                sid = screen.sid,
                machineId = machineId,
                token = screen.token,
                teamId = teamId,
                agentUserId = agentUserId,
                sessionId = sessionId,
                cwd = cwd,
                driver = driver.name,
                createdAt = LocalDateTime.now(),
            )
        )
        agentRegistry.register(
            ScreenAgent(
                userId = agentUserId,
                sid = screen.sid,
                machineId = machineId,
                teamId = teamId,
                screenToken = screen.token,
                driver = driver,
                hub = hub,
            )
        )
        logger.info(
            "opened agent user {} on machine {} (screen {}, driver {})",
            agentUserId,
            machineId,
            screen.sid,
            driver.name,
        )
        return OpenedAgent(agentUserId, screen.sid, machineId, screen.token)
    }

    /** Close an agent: end its screen and stop it hearing the groups it is in. */
    @Transactional
    fun closeAgent(agentUserId: IdType) {
        val rows = agentScreenRepository.findByAgentUserId(agentUserId)
        if (rows.isEmpty()) throw BadRequestError("no such agent: $agentUserId")
        rows.forEach { row ->
            hub.closeScreen(row.machineId, row.sid)
            agentScreenRepository.delete(row)
        }
        agentRegistry.unregister(agentUserId)
    }

    private fun createAgentUser(nickname: String?): IdType {
        val username = "agent-" + UUID.randomUUID().toString().replace("-", "").take(12)
        val user =
            User().apply {
                this.username = username
                hashedPassword =
                    BCrypt.withDefaults()
                        .hashToString(12, UUID.randomUUID().toString().toCharArray())
                email = "$username@$agentEmailDomain"
            }
        userRepository.save(user)
        userProfileRepository.save(
            UserProfile().apply {
                this.nickname = nickname ?: username
                intro = "AI agent"
                avatar = Avatar().also { it.id = 1 }
                this.user = user
            }
        )
        return user.id!!.toLong()
    }
}
