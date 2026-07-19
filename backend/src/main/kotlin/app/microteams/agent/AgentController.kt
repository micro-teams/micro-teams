/*
 *  Description: The agent module's one controller — every method implements an AgentApi operation
 *               generated from MicroTeams-API.yml, nothing more. Opening and closing an agent, the one
 *               agent enumeration, and the machine+screen token exchange all live here; they used to
 *               be four separate hand-written controllers. An agent speaks in a group not through a
 *               special door but through the ordinary `POST /chat/{id}/messages`, as its own user.
 *
 *               listAgents is the only way to enumerate agents: what were a POST carrying a batch
 *               of user ids ("presence") and a second per-thread route are now just filters on it.
 *               `sid` is included per agent only for a caller allowed to watch it — asked of the
 *               permission matrix, the same question the 现场 handshake gates on, rather than a
 *               second copy of the rule.
 *
 *               It registers the agent half of that rule: an agent's screen may also be watched by
 *               someone who shares a group with it, not only by users of its machine. Because that
 *               is a separate permission rather than a branch inside one, a screen with no agent
 *               (a shared shell) is simply never widened.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.agent.screen.AgentService
import app.microteams.agent.screen.ScreenAgent
import app.microteams.api.AgentApi
import app.microteams.chat.thread.ThreadMemberRepository
import app.microteams.machine.link.MachineHub
import app.microteams.model.*
import app.microteams.team.machine.TeamMachineService
import app.microteams.team.membership.TeamService
import app.microteams.user.UserProfileRepository
import javax.annotation.PostConstruct
import org.rucca.cheese.auth.AuthenticationService
import org.rucca.cheese.auth.AuthorizationService
import org.rucca.cheese.auth.AuthorizedAction
import org.rucca.cheese.auth.annotation.AuthInfo
import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.NoAuth
import org.rucca.cheese.auth.error.InvalidTokenError
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

@RestController
class AgentController(
    private val agentService: AgentService,
    private val agentRegistry: AgentRegistry,
    private val agentScreenRepository: AgentScreenRepository,
    private val attribution: AgentAttribution,
    private val threadMemberRepository: ThreadMemberRepository,
    private val userProfileRepository: UserProfileRepository,
    private val hub: MachineHub,
    private val teamService: TeamService,
    private val teamMachineService: TeamMachineService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
    private val agentTokenService: AgentTokenService,
) : AgentApi {

    @PostConstruct
    fun initialize() {
        /**
         * The screen being watched is an agent's, and the caller shares a group with it. False for
         * a screen that is not an agent's — which is how this widens access to our own screens
         * without touching anyone else's.
         */
        register("shares-group-with-screen-agent") { userId, authInfo ->
            val agent = (authInfo["sid"] as? String)?.let { agentRegistry.bySid(it) }
            agent != null && sharesGroup(userId, agent.userId)
        }

        /** The caller belongs to the team the agent being opened will work for. */
        register("is-member-of-target-team") { userId, authInfo ->
            val req = authInfo["open"] as? OpenAgentRequestDTO
            req != null && teamService.isTeamMember(req.teamId, userId)
        }

        /** The caller may use the machine the agent being opened will run on. */
        register("can-access-target-machine") { userId, authInfo ->
            val req = authInfo["open"] as? OpenAgentRequestDTO
            req != null && teamMachineService.mayAccess(userId, req.machineId)
        }

        /** The caller belongs to the team the agent in question works for. */
        register("is-member-of-agent-team") { userId, authInfo ->
            val agentUserId = authInfo["agentUserId"] as? Long ?: return@register false
            val rows = agentScreenRepository.findByAgentUserId(agentUserId)
            rows.isNotEmpty() &&
                rows.all { it.teamId != null && teamService.isTeamMember(it.teamId!!, userId) }
        }
    }

    /** Registers one atomic fact, hiding the seven-parameter handler shape. */
    private fun register(name: String, fact: (IdType, Map<String, Any>) -> Boolean) {
        authorizationService.customAuthLogics.register(name) {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            _: IdType?,
            authInfo: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            fact(userId, authInfo)
        }
    }

    private fun currentUserId(): IdType = authenticationService.getCurrentUserId()

    private fun sharesGroup(userId: IdType, agentUserId: IdType): Boolean {
        val agentThreads =
            threadMemberRepository.findByUserId(agentUserId).mapNotNull { it.threadId }.toSet()
        if (agentThreads.isEmpty()) return false
        return threadMemberRepository
            .findByUserId(userId)
            .mapNotNull { it.threadId }
            .any { it in agentThreads }
    }

    // -- enumeration --------------------------------------------------------

    @Guard("enumerate-agents", "agent")
    override fun listAgents(
        userId: List<Long>?,
        threadId: Long?,
        teamId: Long?,
        machineId: String?,
        online: Boolean?,
        pageStart: Long?,
        pageSize: Int,
    ): ResponseEntity<ListAgentsResponseDTO> {
        val viewerAuth = authorizationService.currentAuthorization()
        val live = agentRegistry.screenAgents().associateBy { it.userId }

        // Every agent we know of, live or not, then narrowed by whichever filters were given.
        var candidates: Set<IdType> =
            (live.keys + agentScreenRepository.findAll().map { it.agentUserId }).toSet()
        userId?.let { ids -> candidates = candidates.filter { it in ids }.toSet() }
        threadId?.let { tid ->
            val members =
                threadMemberRepository.findByThreadId(tid).mapNotNull { it.userId }.toSet()
            candidates = candidates.filter { it in members }.toSet()
        }
        teamId?.let { t -> candidates = candidates.filter { live[it]?.teamId == t }.toSet() }
        machineId?.let { m -> candidates = candidates.filter { live[it]?.machineId == m }.toSet() }
        online?.let { o -> candidates = candidates.filter { (it in live) == o }.toSet() }

        val agents = candidates.sorted().map { toDTO(it, live[it], viewerAuth) }
        val page = agents.take(pageSize)
        return ResponseEntity.ok(
            ListAgentsResponseDTO(
                agents = page,
                page =
                    PageDTO(
                        pageStart = page.firstOrNull()?.userId ?: 0,
                        pageSize = page.size,
                        hasPrev = false,
                        hasMore = agents.size > page.size,
                    ),
            )
        )
    }

    private fun toDTO(
        uid: IdType,
        agent: ScreenAgent?,
        viewerAuth: org.rucca.cheese.auth.Authorization,
    ): AgentDTO {
        val profile = userProfileRepository.findByUserId(uid.toInt()).orElse(null)
        val screen = agent?.let { hub.screen(it.sid) }
        val watchable =
            agent != null &&
                authorizationService.allows(
                    viewerAuth,
                    "watch",
                    "machine_screen",
                    null,
                    mapOf("sid" to agent.sid),
                )
        return AgentDTO(
            userId = uid,
            nickname = profile?.nickname ?: "user$uid",
            avatarId = profile?.avatar?.id?.toLong(),
            online = agent != null,
            machineId = agent?.machineId,
            sid = if (watchable) agent!!.sid else null,
            teamId = agent?.teamId,
            driver = agent?.driver?.name,
            // The live screen's mirrored variables (status/elapsed/tokens/question/choices/
            // compact/…) so the 现场 gatebar can show the same hints web-claude does.
            vars =
                if (watchable)
                    screen?.vars?.entries?.mapNotNull { (k, v) -> v?.let { k to it } }?.toMap()
                else null,
        )
    }

    // -- lifecycle ----------------------------------------------------------

    @Guard("open-agent", "agent")
    override fun openAgent(
        @AuthInfo("open") openAgentRequestDTO: OpenAgentRequestDTO
    ): ResponseEntity<OpenedAgentDTO> {
        val opened =
            agentService.openAgent(
                machineId = openAgentRequestDTO.machineId,
                teamId = openAgentRequestDTO.teamId,
                nickname = openAgentRequestDTO.nickname,
                cwd = openAgentRequestDTO.cwd,
                driverName = openAgentRequestDTO.driver,
                sessionId = openAgentRequestDTO.sessionId,
                resume = openAgentRequestDTO.resume ?: false,
            )
        return ResponseEntity(opened.toDTO(), HttpStatus.CREATED)
    }

    /**
     * Reboot the agent: swap its backing screen for a fresh one resuming the same session. Guarded
     * exactly like closeAgent (`reboot-agent` needs `is-member-of-agent-team`, the same predicate)
     * — it is a lifecycle action on an existing agent, not opening a new one, so the agent user and
     * its memberships stay put.
     */
    @Guard("reboot-agent", "agent")
    override fun rebootAgent(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long
    ): ResponseEntity<OpenedAgentDTO> {
        return ResponseEntity.ok(agentService.rebootAgent(userId).toDTO())
    }

    private fun app.microteams.agent.screen.OpenedAgent.toDTO() =
        OpenedAgentDTO(
            agentUserId = agentUserId,
            sid = sid,
            machineId = machineId,
            screenToken = screenToken,
        )

    @Guard("close-agent", "agent")
    override fun closeAgent(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long
    ): ResponseEntity<Unit> {
        agentService.closeAgent(userId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- the token exchange -------------------------------------------------

    /**
     * Exchange a screen's durable machine + per-screen tokens (headers X-Microteams-Session and
     * X-Microteams-Screen) for a short-lived JWT that is the agent's own user token. This is the
     * ONLY place machine+screen credentials are resolved to an agent user; from here on the agent
     * carries an ordinary Bearer token and every other endpoint authorizes it exactly like a
     * human's, through the matrix — there is no second authorization path.
     *
     * @NoAuth in the literal sense: there is no JWT yet — the CLI is exchanging *for* one. The
     *   machine+screen pair is the credential, and only a screen belonging to *this* machine is
     *   honored (AgentAttribution's cross-machine guard), so it cannot escalate across machines.
     */
    @NoAuth
    override fun exchangeAgentToken(): ResponseEntity<AgentTokenDTO> {
        val request =
            (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes).request
        val machineToken = request.getHeader("X-Microteams-Session")
        val screenToken = request.getHeader("X-Microteams-Screen")

        val actor = attribution.resolve(machineToken, screenToken) ?: throw InvalidTokenError()
        val screen = actor.screen ?: throw InvalidTokenError()
        val agent = agentRegistry.bySid(screen.sid) ?: throw InvalidTokenError()

        val minted = agentTokenService.mint(agent.userId)
        return ResponseEntity.ok(AgentTokenDTO(token = minted.token, expiresAt = minted.expiresAt))
    }

    /**
     * The calling agent's document-tree git workspace. Like exchangeAgentToken this is @NoAuth and
     * resolves the caller from its own Bearer — the applet is already authenticated as the agent
     * (apiauth attaches the JWT), so it just asks "where is my team's git remote, and give me a
     * credential for it". We hand back the URL and a fresh token; the applet passes them to a `git`
     * subprocess, so the connector binary never needs to know any git.
     */
    @NoAuth
    override fun getGitWorkspace(): ResponseEntity<AgentGitWorkspaceDTO> {
        val request =
            (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes).request
        val auth = authorizationService.verify(request.getHeader("Authorization"))
        val (gitUrl, teamId) =
            agentService.gitWorkspaceUrl(auth.userId)
                ?: throw BadRequestError("caller is not an active agent")
        val minted = agentTokenService.mint(auth.userId)
        return ResponseEntity.ok(
            AgentGitWorkspaceDTO(gitUrl = gitUrl, token = minted.token, teamId = teamId)
        )
    }
}
