/*
 *  Description: The machine module's one controller — every method implements a MachineApi
 *               operation generated from MicroTeams-API.yml, nothing more. It is the front door to
 *               enrolling a machine and to the machines themselves; `startEnrollment` and
 *               `pollEnrollment` are public (the machine has no token yet), everything else is
 *               authorized against team membership (a machine token is necessary, never
 *               sufficient).
 *
 *               It holds no authorization of its own. It registers the atomic facts about a
 *               machine that RolePermissionService's rules are written in terms of; every rule
 *               using them is visible there, and only there.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine

import app.microteams.api.MachineApi
import app.microteams.machine.enrollment.MachineInfo
import app.microteams.machine.enrollment.MachineService
import app.microteams.machine.link.MachineHub
import app.microteams.machine.link.MachinePresence
import app.microteams.machine.terminal.TerminalService
import app.microteams.model.*
import app.microteams.team.machine.TeamMachineService
import app.microteams.team.membership.TeamAccess
import jakarta.annotation.PostConstruct
import jakarta.servlet.http.HttpServletRequest
import org.rucca.cheese.auth.AuthenticationService
import org.rucca.cheese.auth.AuthorizationService
import org.rucca.cheese.auth.AuthorizedAction
import org.rucca.cheese.auth.annotation.AuthInfo
import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.NoAuth
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

@RestController
class MachineController(
    private val machineService: MachineService,
    private val teamMachineService: TeamMachineService,
    private val teamService: app.microteams.team.membership.TeamService,
    private val hub: MachineHub,
    private val presence: MachinePresence,
    private val teamAccess: TeamAccess,
    private val terminalService: TerminalService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
) : MachineApi {

    @PostConstruct
    fun initialize() {
        // The atomic facts about a machine that RolePermissionService writes its rules in terms
        // of. None of them decides anything on its own; the matrix composes them. Machine and
        // screen ids are strings, which the matrix cannot carry as a resourceId, so they travel
        // in authInfo (see @AuthInfo on the parameters below).

        /** The caller may use the machine this request addresses. */
        register("can-access-machine") { userId, authInfo ->
            (authInfo["machineId"] as? String)?.let { teamMachineService.mayAccess(userId, it) }
                ?: false
        }

        /** The caller may use the machine being bound to / unbound from a team. */
        register("can-access-bound-machine") { userId, authInfo ->
            val id =
                (authInfo["machineId"] as? String)
                    ?: (authInfo["bind"] as? BindMachineRequestDTO)?.machineId
            id?.let { teamMachineService.mayAccess(userId, it) } ?: false
        }

        /** The caller may use the machine the screen being watched runs on. */
        register("can-access-screen-machine") { userId, authInfo ->
            val screen = (authInfo["sid"] as? String)?.let { hub.screen(it) }
            screen != null && teamMachineService.mayAccess(userId, screen.machineId)
        }

        /** The caller can access the team this enumeration is scoped to. */
        register("can-access-queried-team") { userId, authInfo ->
            (authInfo["teamId"] as? Long)?.let { teamAccess.mayAccess(userId, it) } ?: false
        }

        /** The enumeration is unscoped, which by definition means the caller's own machines. */
        register("is-enumerating-own-machines") { _, authInfo -> authInfo["teamId"] == null }

        /** The caller can access every team this machine is being enrolled into. */
        register("can-access-every-enrolled-team") { userId, authInfo ->
            val req = authInfo["approve"] as? ApproveEnrollmentRequestDTO
            req != null &&
                req.teamIds.isNotEmpty() &&
                req.teamIds.all { teamAccess.mayAccess(userId, it) }
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

    // -- enrollment ---------------------------------------------------------

    @NoAuth
    override fun startEnrollment(
        startEnrollmentRequestDTO: StartEnrollmentRequestDTO,
    ): ResponseEntity<StartEnrollmentResponseDTO> {
        val code = machineService.start(startEnrollmentRequestDTO.name)
        return ResponseEntity.ok(
            StartEnrollmentResponseDTO(code = code, approveUrl = approveUrl(code)),
        )
    }

    @NoAuth
    override fun pollEnrollment(
        pollEnrollmentRequestDTO: PollEnrollmentRequestDTO,
    ): ResponseEntity<PollEnrollmentResponseDTO> {
        val result = machineService.poll(pollEnrollmentRequestDTO.code)
        return ResponseEntity.ok(
            PollEnrollmentResponseDTO(
                status = result.status,
                machineId = result.machineId,
                token = result.token,
            ),
        )
    }

    @Guard("approve-enrollment", "machine")
    override fun approveEnrollment(
        @AuthInfo("approve") approveEnrollmentRequestDTO: ApproveEnrollmentRequestDTO,
    ): ResponseEntity<MachineDTO> =
        ResponseEntity.ok(
            machineService
                .approve(approveEnrollmentRequestDTO.code, approveEnrollmentRequestDTO.teamIds)
                .toDTO(),
        )

    // -- the machines -------------------------------------------------------

    @Guard("enumerate-machines", "machine")
    override fun listMachines(
        @AuthInfo("teamId") teamId: Long?,
        online: Boolean?,
        pageStart: String?,
        pageSize: Int,
    ): ResponseEntity<ListMachinesResponseDTO> {
        val all = machineService.list(currentUserId(), teamId, online) { presence.isOnline(it) }
        val page = all.take(pageSize)
        return ResponseEntity.ok(
            ListMachinesResponseDTO(
                machines = page.map { it.toDTO() },
                page =
                    PageDTO(
                        pageStart = 0,
                        pageSize = page.size,
                        hasPrev = false,
                        hasMore = all.size > page.size,
                    ),
            ),
        )
    }

    @Guard("query-machine", "machine")
    override fun getMachine(
        @PathVariable("id") @AuthInfo("machineId") id: String,
    ): ResponseEntity<MachineDTO> = ResponseEntity.ok(machineService.get(id).toDTO())

    @Guard("rename-machine", "machine")
    override fun renameMachine(
        @PathVariable("id") @AuthInfo("machineId") id: String,
        renameMachineRequestDTO: RenameMachineRequestDTO,
    ): ResponseEntity<MachineDTO> =
        ResponseEntity.ok(machineService.rename(id, renameMachineRequestDTO.name).toDTO())

    @Guard("forget-machine", "machine")
    override fun forgetMachine(
        @PathVariable("id") @AuthInfo("machineId") id: String,
    ): ResponseEntity<Unit> {
        machineService.forget(id)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- terminals and commands ---------------------------------------------

    @Guard("enumerate-terminals", "machine")
    override fun listTerminals(
        @PathVariable("id") @AuthInfo("machineId") id: String,
    ): ResponseEntity<ListTerminalsResponseDTO> =
        ResponseEntity.ok(ListTerminalsResponseDTO(terminals = terminalService.list(id)))

    @Guard("open-terminal", "machine")
    override fun openTerminal(
        @PathVariable("id") @AuthInfo("machineId") id: String,
        openTerminalRequestDTO: OpenTerminalRequestDTO?,
    ): ResponseEntity<TerminalDTO> =
        ResponseEntity.status(HttpStatus.CREATED)
            .body(
                terminalService.open(
                    id,
                    currentUserId(),
                    openTerminalRequestDTO?.command,
                    openTerminalRequestDTO?.cwd,
                ),
            )

    @Guard("query-terminal", "machine")
    override fun getTerminal(
        @PathVariable("id") @AuthInfo("machineId") id: String,
        @PathVariable("sid") sid: String,
    ): ResponseEntity<TerminalDetailDTO> = ResponseEntity.ok(terminalService.detail(id, sid))

    @Guard("close-terminal", "machine")
    override fun closeTerminal(
        @PathVariable("id") @AuthInfo("machineId") id: String,
        @PathVariable("sid") sid: String,
    ): ResponseEntity<Unit> {
        terminalService.close(id, sid)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    private fun MachineInfo.toDTO() =
        MachineDTO(
            id = machineId,
            name = name,
            online = presence.isOnline(machineId),
            teams = teamService.teamsByIds(teams),
            createdAt = null,
        )

    private fun approveUrl(code: String): String {
        // Prefer proxy-forwarded host/proto (we sit behind nginx), fall back to the request's own.
        // The CLI prints this URL for the human to approve at. The web app lives under /app/ (see
        // deploy/nginx.conf), so the page is /app/connect — a bare /connect is a 404.
        val request =
            (org.springframework.web.context.request.RequestContextHolder.currentRequestAttributes()
                    as org.springframework.web.context.request.ServletRequestAttributes)
                .request
        return "${origin(request)}/app/connect?code=$code"
    }

    private fun origin(request: HttpServletRequest): String {
        val proto = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host")
        return "$proto://$host"
    }
}
