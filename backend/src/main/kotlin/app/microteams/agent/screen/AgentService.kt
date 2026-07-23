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
import app.microteams.team.membership.TeamMemberRole
import app.microteams.team.membership.TeamService
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
    private val teamService: TeamService,
    private val agentScreenRepository: AgentScreenRepository,
    private val agentRegistry: AgentRegistry,
    private val userRepository: UserRepository,
    private val userProfileRepository: UserProfileRepository,
    drivers: List<AgentDriver>,
    // Fallback MICROTEAMS_API, used only for a machine that connected without reporting its own
    // endpoint (an older CLI). Normally the origin comes from the machine's live connection, so the
    // server never assumes its own address. See MachineHub.origin.
    @Value("\${application.connector-origin:http://127.0.0.1:8080}")
    private val connectorOrigin: String,
    @Value("\${application.agent-email-domain:agents.microteams.local}")
    private val agentEmailDomain: String,
    @Value("\${application.default-agent-driver:claude}") private val defaultDriver: String,
) {
    private val logger = LoggerFactory.getLogger(AgentService::class.java)
    private val driversByName = drivers.associateBy { it.name }

    /** The driver names this server supports (for the open-agent form's picker). */
    fun driverNames(): List<String> = driversByName.keys.sorted()

    /** The driver used when a caller opens an agent without naming one. */
    val defaultDriverName: String
        get() = defaultDriver

    /**
     * The default working directory when a caller doesn't name one: a private per-agent checkout of
     * the team document tree, under the user data dir (`~/.local/share/microteams/agents/<name>`),
     * so each agent gets its own clone rather than sharing one per team. Named after the agent's
     * nickname (filesystem-sanitised) with its user id appended for uniqueness; the id alone when
     * unnamed. The leading `~` is expanded on the machine by the driver.
     */
    private fun defaultWorkCwd(nickname: String?, agentUserId: IdType): String {
        val slug =
            nickname?.lowercase()?.replace(Regex("[^a-z0-9]+"), "-")?.trim('-')?.take(40).orEmpty()
        val name = if (slug.isBlank()) "agent-$agentUserId" else "$slug-$agentUserId"
        return "~/.local/share/microteams/agents/$name"
    }

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
        // The session id to open with. When null we mint one; a caller may pass an opaque id (kept
        // opaque here — its meaning is the driver's) to open a specific session, and pair it with
        // resume=true to continue that session's prior transcript from [cwd].
        sessionId: String? = null,
        resume: Boolean = false,
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
        // The agent must be a member of the team it works for, or it cannot even read its own
        // team's document tree: read/write-document and the git remote are all gated by
        // is-team-member.
        teamService.addMember(teamId, agentUserId, TeamMemberRole.MEMBER)
        val session = sessionId ?: UUID.randomUUID().toString() // mint one when not supplied
        // Default to a private per-agent checkout of the team document tree, under the user data
        // dir (~/.local/share/microteams/agents/<name>), so each agent gets its own clone rather
        // than sharing one per team. The applet's `docs sync` clones the team repo here on first
        // run; a caller that wants the agent elsewhere (e.g. a source-code checkout) passes an
        // explicit cwd.
        val workCwd = cwd ?: defaultWorkCwd(nickname, agentUserId)
        val opened = launch(agentUserId, machineId, teamId, workCwd, driver, session, resume)
        logger.info(
            "opened agent user {} on machine {} (screen {}, driver {}, session {}, resume {})",
            agentUserId,
            machineId,
            opened.sid,
            driver.name,
            session,
            resume,
        )
        return opened
    }

    /**
     * Reboot an agent: end its current screen and relaunch the SAME session (same session id, cwd,
     * driver and machine) with resume=true, so the driver continues where it left off. The agent
     * user and its group memberships are untouched — only the backing screen (its sid + screen
     * token) is replaced, and the AgentScreen row and registry entry are swapped to the new one.
     */
    @Transactional
    fun rebootAgent(agentUserId: IdType): OpenedAgent {
        val row =
            agentScreenRepository.findByAgentUserId(agentUserId).firstOrNull()
                ?: throw BadRequestError("no such agent: $agentUserId")
        val driver =
            driversByName[row.driver] ?: throw BadRequestError("unknown driver: ${row.driver}")
        val session =
            row.sessionId ?: throw BadRequestError("agent $agentUserId has no session id to resume")
        if (!hub.isOnline(row.machineId)) {
            throw BadRequestError("machine is not connected")
        }

        // Tear down the old screen and its bookkeeping first, then relaunch resuming the session.
        hub.closeScreen(row.machineId, row.sid)
        agentRegistry.unregister(agentUserId)
        agentScreenRepository.delete(row)

        val reopened =
            launch(agentUserId, row.machineId, row.teamId, row.cwd, driver, session, resume = true)
        logger.info(
            "rebooted agent user {} on machine {} (screen {} -> {}, driver {}, session {})",
            agentUserId,
            row.machineId,
            row.sid,
            reopened.sid,
            driver.name,
            session,
        )
        return reopened
    }

    /**
     * Open a screen for [agentUserId] and wire it up: launch the driver, persist the AgentScreen
     * row and register the ScreenAgent so chat can reach it. Shared by first-open and reboot, the
     * only difference being the session id and whether the driver resumes.
     */
    private fun launch(
        agentUserId: IdType,
        machineId: String,
        teamId: IdType?,
        cwd: String?,
        driver: AgentDriver,
        sessionId: String,
        resume: Boolean,
    ): OpenedAgent {
        // The screen's `microteams api` authenticates as this machine (MICROTEAMS_TOKEN) against
        // this server (MICROTEAMS_API); paired with the per-screen MICROTEAMS_SCREEN the CLI
        // injects, the tool-door attributes the call to this agent. We inject MICROTEAMS_TOKEN
        // explicitly (the reference relies on the machine's on-disk config token, but injecting is
        // robust to a machine whose default CLI config points elsewhere).
        val env = buildMap {
            // The endpoint this machine reached us on (it reported it when it connected), so its
            // screens call back on a URL that works for them; the config value is only a fallback.
            put("MICROTEAMS_API", hub.originOf(machineId) ?: connectorOrigin)
            machineService.tokenOf(machineId)?.let { put("MICROTEAMS_TOKEN", it) }
            // The team the agent works for, so the applet's `docs` commands know which tree to
            // sync.
            put("MICROTEAMS_TEAM", teamId.toString())
        }
        val screen =
            hub.openScreen(
                machineId = machineId,
                command = driver.command(sessionId, cwd, resume = resume),
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

    /**
     * The document-tree git remote for [agentUserId] paired with its team id: the team's repo on
     * the endpoint this agent's machine dialed us on, so the URL resolves from that machine (the
     * config value is only a fallback). Null if the user is not an active agent. The caller mints
     * the matching credential; together they are what the applet hands a `git` subprocess.
     */
    fun gitWorkspaceUrl(agentUserId: IdType): Pair<String, IdType>? {
        val row = agentScreenRepository.findByAgentUserId(agentUserId).firstOrNull() ?: return null
        val teamId = row.teamId ?: return null
        val base = hub.originOf(row.machineId) ?: connectorOrigin
        return "$base/git/$teamId" to teamId
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
