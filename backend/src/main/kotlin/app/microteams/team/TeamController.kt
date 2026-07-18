/*
 *  Description: The team module's one controller — every method implements a TeamApi
 *               operation generated from MicroTeams-API.yml, nothing more. It serves the whole
 *               /team surface: the team itself and its membership (delegated to
 *               membership/TeamService) and the team's documents (delegated to
 *               documents/DocumentService), and registers the team authorization logics
 *               (owner resolver, member/admin predicates).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team

import app.microteams.api.TeamApi
import app.microteams.machine.enrollment.MachineService
import app.microteams.model.*
import app.microteams.team.documents.DocumentService
import app.microteams.team.membership.*
import javax.annotation.PostConstruct
import javax.validation.Valid
import org.rucca.cheese.auth.AuthenticationService
import org.rucca.cheese.auth.AuthorizationService
import org.rucca.cheese.auth.AuthorizedAction
import org.rucca.cheese.auth.annotation.AuthInfo
import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.ResourceId
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
class TeamController(
    private val teamService: TeamService,
    private val documentService: DocumentService,
    private val machineService: MachineService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
) : TeamApi {
    @PostConstruct
    fun initialize() {
        authorizationService.ownerIds.register("team", teamService::getTeamOwner)
        authorizationService.customAuthLogics.register("is-team-member") {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            _: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            resourceId != null && teamService.isTeamMember(resourceId, userId)
        }
        authorizationService.customAuthLogics.register("is-team-admin") {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            _: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            resourceId != null && teamService.isTeamAdmin(resourceId, userId)
        }
    }

    private fun currentUserId(): IdType = authenticationService.getCurrentUserId()

    @Guard("create-team", "team")
    override fun createTeam(
        @Valid @RequestBody(required = false) dto: CreateTeamRequestDTO?
    ): ResponseEntity<TeamDTO> {
        val name = dto?.name ?: return ResponseEntity.badRequest().build()
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(teamService.createTeam(name, currentUserId()))
    }

    @Guard("enumerate-my-teams", "team")
    override fun listTeams(
        role: String?,
        pageStart: Long?,
        pageSize: Int,
    ): ResponseEntity<ListTeamsResponseDTO> {
        val roleFilter =
            role?.let {
                runCatching { TeamMemberRole.valueOf(it) }
                    .getOrElse { throw BadRequestError("invalid role: $role") }
            }
        val (teams, page) =
            teamService.listMyTeams(currentUserId(), roleFilter, pageStart, pageSize)
        return ResponseEntity.ok(ListTeamsResponseDTO(teams = teams, page = page))
    }

    @Guard("query-team", "team")
    override fun getTeam(
        @PathVariable("id") @ResourceId id: IdType
    ): ResponseEntity<TeamDetailDTO> = ResponseEntity.ok(teamService.getTeamDetail(id))

    @Guard("rename-team", "team")
    override fun renameTeam(
        @PathVariable("id") @ResourceId id: IdType,
        @Valid @RequestBody(required = false) dto: RenameTeamRequestDTO?,
    ): ResponseEntity<TeamDTO> {
        val name = dto?.name ?: return ResponseEntity.badRequest().build()
        return ResponseEntity.ok(teamService.renameTeam(id, name))
    }

    @Guard("delete-team", "team")
    override fun deleteTeam(@PathVariable("id") @ResourceId id: IdType): ResponseEntity<Unit> {
        teamService.deleteTeam(id)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("enumerate-team-members", "team")
    override fun listTeamMembers(
        @PathVariable("id") @ResourceId id: IdType
    ): ResponseEntity<List<TeamMemberDTO>> = ResponseEntity.ok(teamService.listMembers(id))

    @Guard("add-team-member", "team")
    override fun addTeamMember(
        @PathVariable("id") @ResourceId id: IdType,
        @Valid @RequestBody(required = false) dto: AddTeamMemberRequestDTO?,
    ): ResponseEntity<Unit> {
        if (dto == null) return ResponseEntity.badRequest().build()
        teamService.addMember(id, dto.userId, dto.role.convert())
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("change-team-member-role", "team")
    override fun changeMemberRole(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("userId") userId: IdType,
        @Valid @RequestBody(required = false) dto: ChangeRoleRequestDTO?,
    ): ResponseEntity<Unit> {
        val role = dto?.role?.convert() ?: return ResponseEntity.badRequest().build()
        teamService.changeRole(id, userId, role)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("remove-team-member", "team")
    override fun removeTeamMember(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("userId") userId: IdType,
    ): ResponseEntity<Unit> {
        teamService.removeMember(id, userId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- Machines (which machines this team owns; enumerate via GET /machine?teamId=) ----

    @Guard("bind-machine-to-team", "team")
    override fun bindTeamMachine(
        @PathVariable("id") @ResourceId id: IdType,
        @AuthInfo("bind") bindMachineRequestDTO: BindMachineRequestDTO,
    ): ResponseEntity<Unit> {
        machineService.bindToTeam(bindMachineRequestDTO.machineId, id)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("unbind-machine-from-team", "team")
    override fun unbindTeamMachine(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("machineId") @AuthInfo("machineId") machineId: String,
    ): ResponseEntity<Unit> {
        machineService.unbindFromTeam(machineId, id)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- Documents (the team's git tree; no document table) ------------------

    /** Rejects paths that could escape the repo. Empty path is allowed (= repo root). */
    private fun checkPath(path: String) {
        val unsafe =
            path.startsWith("/") || path.startsWith("\\") || path.split('/').any { it == ".." }
        if (unsafe) throw BadRequestError("unsafe path: $path")
    }

    private fun requirePath(path: String) {
        if (path.isBlank()) throw BadRequestError("path is required")
    }

    @Guard("read-document", "team_document")
    override fun getDocument(
        @PathVariable("id") @ResourceId id: IdType,
        path: String,
        recursive: Boolean,
        content: Boolean,
        history: Boolean,
        diff: String?,
    ): ResponseEntity<DocNodeDTO> {
        checkPath(path)
        return ResponseEntity.ok(
            documentService.getDocument(id, path, recursive, content, history, diff)
        )
    }

    @Guard("write-document", "team_document")
    override fun writeDocument(
        @PathVariable("id") @ResourceId id: IdType,
        path: String,
        body: String?,
    ): ResponseEntity<DocNodeDTO> {
        checkPath(path)
        requirePath(path)
        return ResponseEntity.ok(
            documentService.writeDocument(id, path, body ?: "", currentUserId())
        )
    }

    @Guard("move-document", "team_document")
    override fun moveDocument(
        @PathVariable("id") @ResourceId id: IdType,
        path: String,
        moveDocumentRequestDTO: MoveDocumentRequestDTO,
    ): ResponseEntity<DocNodeDTO> {
        checkPath(path)
        requirePath(path)
        checkPath(moveDocumentRequestDTO.newPath)
        requirePath(moveDocumentRequestDTO.newPath)
        return ResponseEntity.ok(
            documentService.moveDocument(id, path, moveDocumentRequestDTO.newPath, currentUserId())
        )
    }

    @Guard("delete-document", "team_document")
    override fun deleteDocument(
        @PathVariable("id") @ResourceId id: IdType,
        path: String,
    ): ResponseEntity<Unit> {
        checkPath(path)
        requirePath(path)
        documentService.deleteDocument(id, path, currentUserId())
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }
}
