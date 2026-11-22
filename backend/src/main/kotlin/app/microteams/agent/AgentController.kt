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
 *               permission matrix, the same question the live-screen handshake gates on, rather than a
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
import app.microteams.chat.thread.ThreadRepository
import app.microteams.chat.thread.toDTO
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.MachinePresence
import app.microteams.model.*
import app.microteams.team.machine.TeamMachineService
import app.microteams.team.membership.TeamAccess
import app.microteams.team.membership.TeamService
import app.microteams.user.UserProfileRepository
import jakarta.annotation.PostConstruct
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
    private val agentProfileService: AgentProfileService,
    private val agentKeepaliveService: AgentKeepaliveService,
    private val agentLlmService: AgentLlmService,
    private val agentRegistry: AgentRegistry,
    private val agentScreenRepository: AgentScreenRepository,
    private val attribution: AgentAttribution,
    private val threadMemberRepository: ThreadMemberRepository,
    private val userProfileRepository: UserProfileRepository,
    private val hub: MachineHub,
    private val presence: MachinePresence,
    private val teamService: TeamService,
    private val teamAccess: TeamAccess,
    private val threadRepository: ThreadRepository,
    private val teamMachineService: TeamMachineService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
    private val agentTokenService: AgentTokenService,
) : AgentApi {

    @PostConstruct
    fun initialize() {
        /**
         * The screen being watched is an agent's, and the caller may use the machine that agent
         * runs on — resolved from its persisted row, so the right survives a server that has
         * forgotten the screen. For a live screen this asks exactly what can-access-screen-machine
         * asks; it differs only in where it reads the machine id from.
         */
        register("can-access-agent-screen-machine") { userId, authInfo ->
            val row =
                (authInfo["sid"] as? String)?.let {
                    agentScreenRepository.findById(it).orElse(null)
                }
            row != null && teamMachineService.mayAccess(userId, row.machineId)
        }

        /** The caller can access the team the agent being opened will join. */
        register("can-access-target-team") { userId, authInfo ->
            val req = authInfo["open"] as? OpenAgentRequestDTO
            req != null && teamAccess.mayAccess(userId, req.teamId)
        }

        /** The caller may use the machine the agent being opened will run on. */
        register("can-access-target-machine") { userId, authInfo ->
            val req = authInfo["open"] as? OpenAgentRequestDTO
            req != null && teamMachineService.mayAccess(userId, req.machineId)
        }

        /** The caller can access the agent in question (see mayAccessAgent). */
        register("can-access-agent") { userId, authInfo ->
            val agentUserId = authInfo["agentUserId"] as? Long ?: return@register false
            mayAccessAgent(userId, agentUserId)
        }

        // The two rules below are the placement rule for agents: putting an agent somewhere (a
        // thread, a team) needs access to the agent. They are registered here, in the agent
        // module, because only it knows what an agent is; chat's and team's permission rows
        // reference them by name, so neither imports agent.

        /**
         * The single user being added to a thread or a team is a person, or an agent the caller can
         * access.
         */
        register("added-user-is-accessible") { userId, authInfo ->
            val target =
                (authInfo["addMember"] as? AddMemberRequestDTO)?.userId
                    ?: (authInfo["addTeamMember"] as? AddTeamMemberRequestDTO)?.userId
                    ?: return@register true
            mayPlaceUser(userId, target)
        }

        /**
         * Every member listed on a thread being created is a person or an agent the caller can
         * access.
         */
        register("initial-members-are-accessible") { userId, authInfo ->
            val ids =
                (authInfo["createThread"] as? CreateThreadRequestDTO)?.memberIds
                    ?: (authInfo["teamChat"] as? TeamChatRequestDTO)?.memberIds
                    ?: emptyList()
            ids.all { mayPlaceUser(userId, it) }
        }
    }

    /**
     * Whether [callerId] can access agent [agentUserId]: it is in a team the caller can access, or
     * it runs on a machine the caller may use. The two coincide while every agent's machine is in
     * all of its teams; the second keeps an agent that is in no team reachable from its machine.
     */
    private fun mayAccessAgent(callerId: IdType, agentUserId: IdType): Boolean {
        val rows = agentScreenRepository.findByAgentUserId(agentUserId)
        if (rows.isEmpty()) return false
        val mine = teamAccess.accessibleTeamIds(callerId)
        if (teamAccess.memberTeamIds(agentUserId).any { it in mine }) return true
        return rows.any { teamMachineService.mayAccess(callerId, it.machineId) }
    }

    /** A person may be placed anywhere; an agent only by someone who can access it. */
    private fun mayPlaceUser(callerId: IdType, targetUserId: IdType): Boolean =
        agentScreenRepository.findByAgentUserId(targetUserId).isEmpty() ||
            mayAccessAgent(callerId, targetUserId)

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
        //
        // The rows are kept, not just their ids: an agent is a persisted AgentScreen row, and the
        // registry holds only what this server has re-adopted since it started. So a filter that
        // reads the live entry alone answers "no" for every agent after a restart, and for every
        // agent whose machine is offline — the exact moment a human goes looking for it. `toDTO`
        // below already describes such an agent from its row; the filters have to agree.
        val rows = agentScreenRepository.findAll().groupBy { it.agentUserId }
        var candidates: Set<IdType> = (live.keys + rows.keys).toSet()
        userId?.let { ids -> candidates = candidates.filter { it in ids }.toSet() }
        threadId?.let { tid ->
            val members =
                threadMemberRepository.findByThreadId(tid).mapNotNull { it.userId }.toSet()
            candidates = candidates.filter { it in members }.toSet()
        }
        teamId?.let { t ->
            val members = teamService.listMembers(t).map { it.userId }.toSet()
            candidates = candidates.filter { it in members }.toSet()
        }
        machineId?.let { m ->
            candidates =
                candidates
                    .filter { (live[it]?.machineId ?: rows[it]?.first()?.machineId) == m }
                    .toSet()
        }
        online?.let { o ->
            candidates =
                candidates
                    .filter { reachable(live[it]?.machineId ?: rows[it]?.first()?.machineId) == o }
                    .toSet()
        }

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
            ),
        )
    }

    // Online means reachable, not "a program is running this instant": a connected machine plus
    // the agent's row is all it takes to (re)start it the moment somebody talks to it or watches
    // it. It is derived from the machine's link alone, because the screens the hub keeps for a
    // machine outlive its link (they wait to be re-adopted) and would otherwise keep an agent
    // online on a machine that is gone.
    private fun reachable(machineId: String?): Boolean =
        machineId != null && presence.isOnline(machineId)

    private fun toDTO(
        uid: IdType,
        agent: ScreenAgent?,
        viewerAuth: org.rucca.cheese.auth.Authorization,
    ): AgentDTO {
        val profile = userProfileRepository.findByUserId(uid.toInt()).orElse(null)
        // An agent is described from its persisted row when this server holds nothing live for it.
        // Reporting such an agent as offline with no screen id is what made a forgotten screen
        // unreachable in the UI: the avatar is only clickable when it is online AND carries a sid,
        // so the human could not even ASK for the live screen — which is precisely the request that
        // rebuilds
        // and restarts it. The row is the durable truth about which screen an agent is, and the
        // machine being connected is what makes it reachable.
        val row = agentScreenRepository.findByAgentUserId(uid).firstOrNull()
        val sid = agent?.sid ?: row?.sid
        val machineId = agent?.machineId ?: row?.machineId
        val screen = sid?.let { hub.screen(it) }
        val watchable =
            sid != null &&
                authorizationService.allows(
                    viewerAuth,
                    "watch",
                    "machine_screen",
                    null,
                    mapOf("sid" to sid),
                )
        return AgentDTO(
            userId = uid,
            nickname = profile?.nickname ?: "user$uid",
            avatarId = profile?.avatar?.id?.toLong(),
            online = reachable(machineId),
            machineId = machineId,
            sid = if (watchable) sid else null,
            teams = teamService.teamsByIds(teamAccess.memberTeamIds(uid)),
            chats =
                threadMemberRepository
                    .findByUserId(uid)
                    .mapNotNull { it.threadId }
                    .mapNotNull { threadRepository.findById(it).orElse(null)?.toDTO() }
                    .sortedBy { it.id },
            driver = agent?.driver?.name ?: row?.driver,
            // The live screen's mirrored variables (status/elapsed/tokens/question/choices/
            // compact/…) so the live-screen gatebar can show the same hints web-claude does.
            vars =
                if (watchable)
                    screen?.vars?.entries?.mapNotNull { (k, v) -> v?.let { k to it } }?.toMap()
                else null,
            keepalive =
                agentKeepaliveService.get(uid)?.let {
                    AgentKeepaliveDTO(enabled = it.enabled, intervalSeconds = it.intervalSeconds)
                },
            // Never the key: whether one is set is all anybody, the agent included, gets back.
            llm =
                agentLlmService.get(uid)?.let {
                    AgentLlmDTO(
                        provider = AgentLlmDTO.Provider.forValue(it.provider),
                        api = it.api,
                        baseUrl = it.baseUrl,
                        model = it.model,
                        hasApiKey = it.apiKey != null,
                    )
                },
        )
    }

    @Guard("list-drivers", "agent")
    override fun listAgentDrivers(): ResponseEntity<AgentDriversDTO> =
        ResponseEntity.ok(
            AgentDriversDTO(
                drivers = agentService.driverNames(),
                defaultDriver = agentService.defaultDriverName,
            ),
        )

    // -- lifecycle ----------------------------------------------------------

    @Guard("open-agent", "agent")
    override fun openAgent(
        @AuthInfo("open") openAgentRequestDTO: OpenAgentRequestDTO,
    ): ResponseEntity<OpenedAgentDTO> {
        val opened =
            agentService.openAgent(
                openedBy = currentUserId(),
                machineId = openAgentRequestDTO.machineId,
                teamId = openAgentRequestDTO.teamId,
                nickname = openAgentRequestDTO.nickname,
                cwd = openAgentRequestDTO.cwd,
                driverName = openAgentRequestDTO.driver,
                sessionId = openAgentRequestDTO.sessionId,
                resume = openAgentRequestDTO.resume ?: false,
                llm = openAgentRequestDTO.llm?.toChange(),
            )
        return ResponseEntity(opened.toDTO(), HttpStatus.CREATED)
    }

    /**
     * Reboot the agent: swap its backing screen for a fresh one resuming the same session. Guarded
     * exactly like closeAgent (`reboot-agent` needs `can-access-agent`, the same predicate) — it is
     * a lifecycle action on an existing agent, not opening a new one, so the agent user and its
     * memberships stay put.
     */
    @Guard("reboot-agent", "agent")
    override fun rebootAgent(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
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

    /**
     * Change an agent's avatar. Same team-membership rule as close/reboot: managing an existing
     * agent. The image is already uploaded (by the caller, to the identity service); what a human
     * cannot do is point ANOTHER user's profile at it, which is why this exists — see
     * AgentProfileService.
     */
    @Guard("change-agent-avatar", "agent")
    override fun setAgentAvatar(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
        setAgentAvatarRequestDTO: SetAgentAvatarRequestDTO,
    ): ResponseEntity<AgentDTO> {
        agentProfileService.setAvatar(userId, setAgentAvatarRequestDTO.avatarId)
        val viewerAuth = authorizationService.currentAuthorization()
        return ResponseEntity.ok(
            toDTO(userId, agentRegistry.get(userId) as? ScreenAgent, viewerAuth),
        )
    }

    /**
     * Rename an agent (change its profile nickname). Same team-membership rule as
     * close/reboot/avatar: managing an existing agent. What a human cannot do is change ANOTHER
     * user's profile, which is why this exists — the server performs the change as the agent
     * itself, see AgentProfileService.
     */
    @Guard("change-agent-nickname", "agent")
    override fun setAgentNickname(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
        setAgentNicknameRequestDTO: SetAgentNicknameRequestDTO,
    ): ResponseEntity<AgentDTO> {
        agentProfileService.setNickname(userId, setAgentNicknameRequestDTO.nickname)
        val viewerAuth = authorizationService.currentAuthorization()
        return ResponseEntity.ok(
            toDTO(userId, agentRegistry.get(userId) as? ScreenAgent, viewerAuth),
        )
    }

    /**
     * Turn the agent's cache keepalive on or off and set its interval. Same team-membership rule as
     * the other manage-an-existing-agent actions: it only writes this server's own scheduling, so
     * belonging to the agent's team is the whole permission question. See AgentKeepaliveService.
     */
    @Guard("change-agent-keepalive", "agent")
    override fun setAgentKeepalive(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
        setAgentKeepaliveRequestDTO: SetAgentKeepaliveRequestDTO,
    ): ResponseEntity<AgentDTO> {
        agentKeepaliveService.setKeepalive(
            userId,
            setAgentKeepaliveRequestDTO.enabled,
            setAgentKeepaliveRequestDTO.intervalSeconds,
        )
        val viewerAuth = authorizationService.currentAuthorization()
        return ResponseEntity.ok(
            toDTO(userId, agentRegistry.get(userId) as? ScreenAgent, viewerAuth),
        )
    }

    /**
     * Set which model API the agent's program uses (drivers that take one from MicroTeams: dsh).
     * Same team-membership rule as the other manage-an-existing-agent actions. The key is
     * write-only; the change reaches the program at its next start, so the caller reboots to apply.
     */
    @Guard("change-agent-llm", "agent")
    override fun setAgentLlm(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
        agentLlmSettingsDTO: AgentLlmSettingsDTO,
    ): ResponseEntity<AgentDTO> {
        agentLlmService.set(userId, agentLlmSettingsDTO.toChange())
        val viewerAuth = authorizationService.currentAuthorization()
        return ResponseEntity.ok(
            toDTO(userId, agentRegistry.get(userId) as? ScreenAgent, viewerAuth),
        )
    }

    private fun AgentLlmSettingsDTO.toChange() =
        AgentLlmChange(
            provider = provider.value,
            api = api?.value,
            baseUrl = baseUrl,
            model = model,
            apiKey = apiKey,
        )

    @Guard("close-agent", "agent")
    override fun closeAgent(
        @PathVariable("userId") @AuthInfo("agentUserId") userId: Long,
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
    override fun getGitWorkspace(teamId: Long?): ResponseEntity<AgentGitWorkspaceDTO> {
        val request =
            (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes).request
        val auth = authorizationService.verify(request.getHeader("Authorization"))
        val teams = teamAccess.accessibleTeamIds(auth.userId)
        val team =
            teamId?.also {
                if (it !in teams) throw BadRequestError("this agent cannot access team $it")
            }
                ?: teamAccess.memberTeamIds(auth.userId).singleOrNull()
                ?: throw BadRequestError(
                    "say which team (teamId): this agent is in ${teams.size} teams",
                )
        val gitUrl =
            agentService.gitWorkspaceUrl(auth.userId, team)
                ?: throw BadRequestError("caller is not an active agent")
        val minted = agentTokenService.mint(auth.userId)
        return ResponseEntity.ok(
            AgentGitWorkspaceDTO(gitUrl = gitUrl, token = minted.token, teamId = team),
        )
    }
}
