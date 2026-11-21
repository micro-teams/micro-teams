/*
 *  Description: The team module's one controller — every method implements a TeamApi
 *               operation generated from MicroTeams-API.yml, nothing more. It serves the whole
 *               /team surface: the team itself and its membership (delegated to
 *               membership/TeamService) and the team's documents (delegated to
 *               documents/DocumentService), the teams inside it, its chats (team/chat) and
 *               its machines, and registers the team authorization predicates: whether the
 *               caller can access a team (TeamAccess), a thread (through its teams), or is
 *               acting on themselves (leaving).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.team

import app.microteams.api.TeamApi
import app.microteams.chat.thread.ThreadService
import app.microteams.machine.enrollment.MachineService
import app.microteams.model.*
import app.microteams.team.chat.TeamChatService
import app.microteams.team.documents.DocumentService
import app.microteams.team.membership.TeamAccess
import app.microteams.team.membership.TeamService
import jakarta.annotation.PostConstruct
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
    private val teamAccess: TeamAccess,
    private val teamChatService: TeamChatService,
    private val threadService: ThreadService,
    private val documentService: DocumentService,
    private val machineService: MachineService,
    private val authorizationService: AuthorizationService,
    private val authenticationService: AuthenticationService,
) : TeamApi {
    @PostConstruct
    fun initialize() {
        /** The caller can access the team the request addresses (resource id). */
        register("can-access-team") { userId, resourceId, _ ->
            resourceId != null && teamAccess.mayAccess(userId, resourceId)
        }

        /**
         * A team being created inside another: the caller can access that parent (or there is
         * none).
         */
        register("can-access-parent-team") { userId, _, authInfo ->
            val parent = (authInfo["createTeam"] as? CreateTeamRequestDTO)?.parentId
            parent == null || teamAccess.mayAccess(userId, parent)
        }

        /** The team being put inside this one is a team the caller can access. */
        register("can-access-nested-team") { userId, _, authInfo ->
            val child = (authInfo["subteam"] as? AddSubteamRequestDTO)?.teamId
            child != null && teamAccess.mayAccess(userId, child)
        }

        /** The thread being put into this team (if an existing one) is one the caller can read. */
        register("can-read-placed-thread") { userId, _, authInfo ->
            val thread = (authInfo["teamChat"] as? TeamChatRequestDTO)?.threadId
            thread == null || teamChatService.mayRead(userId, thread)
        }

        /**
         * The caller can read the thread the request addresses: a member, or through one of its
         * teams.
         */
        register("can-read-thread") { userId, resourceId, _ ->
            resourceId != null && teamChatService.mayRead(userId, resourceId)
        }

        /** The user the request removes is the caller: leaving. */
        register("is-removing-self") { userId, _, authInfo -> authInfo["userId"] == userId }
    }

    /** Registers one atomic fact, hiding the seven-parameter handler shape. */
    private fun register(name: String, fact: (IdType, IdType?, Map<String, Any>) -> Boolean) {
        authorizationService.customAuthLogics.register(name) {
            userId: IdType,
            _: AuthorizedAction,
            _: String,
            resourceId: IdType?,
            authInfo: Map<String, Any>,
            _: IdGetter?,
            _: Any? ->
            fact(userId, resourceId, authInfo)
        }
    }

    private fun currentUserId(): IdType = authenticationService.getCurrentUserId()

    @Guard("create-team", "team")
    override fun createTeam(
        @AuthInfo("createTeam") createTeamRequestDTO: CreateTeamRequestDTO?,
    ): ResponseEntity<TeamDTO> {
        val dto = createTeamRequestDTO ?: return ResponseEntity.badRequest().build()
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(teamService.createTeam(dto.name, currentUserId(), dto.parentId))
    }

    @Guard("enumerate-my-teams", "team")
    override fun listTeams(pageStart: Long?, pageSize: Int): ResponseEntity<ListTeamsResponseDTO> {
        val (teams, page) = teamService.listMyTeams(currentUserId(), pageStart, pageSize)
        return ResponseEntity.ok(ListTeamsResponseDTO(teams = teams, page = page))
    }

    @Guard("query-team", "team")
    override fun getTeam(
        @PathVariable("id") @ResourceId id: IdType,
    ): ResponseEntity<TeamDetailDTO> =
        ResponseEntity.ok(teamService.getTeamDetail(id, currentUserId()))

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
        @PathVariable("id") @ResourceId id: IdType,
    ): ResponseEntity<List<TeamMemberDTO>> = ResponseEntity.ok(teamService.listMembers(id))

    @Guard("add-team-member", "team")
    override fun addTeamMember(
        @PathVariable("id") @ResourceId id: IdType,
        @AuthInfo("addTeamMember") addTeamMemberRequestDTO: AddTeamMemberRequestDTO?,
    ): ResponseEntity<Unit> {
        val dto = addTeamMemberRequestDTO ?: return ResponseEntity.badRequest().build()
        teamService.addMember(id, dto.userId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("remove-team-member", "team")
    override fun removeTeamMember(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("userId") @AuthInfo("userId") userId: IdType,
    ): ResponseEntity<Unit> {
        teamService.removeMember(id, userId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- Teams inside this one ----------------------------------------------

    @Guard("add-subteam", "team")
    override fun addSubteam(
        @PathVariable("id") @ResourceId id: IdType,
        @AuthInfo("subteam") addSubteamRequestDTO: AddSubteamRequestDTO?,
    ): ResponseEntity<Unit> {
        val dto = addSubteamRequestDTO ?: return ResponseEntity.badRequest().build()
        teamService.addSubteam(id, dto.teamId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    @Guard("remove-subteam", "team")
    override fun removeSubteam(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("childId") childId: IdType,
    ): ResponseEntity<Unit> {
        teamService.removeSubteam(id, childId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- Chats in this team -------------------------------------------------

    @Guard("enumerate-team-chats", "team")
    override fun listTeamChats(
        @PathVariable("id") @ResourceId id: IdType,
        queryIsMemberAgent: Boolean,
    ): ResponseEntity<ListChatsResponseDTO> {
        val chats =
            threadService.summaries(
                teamChatService.threadIdsOf(id),
                currentUserId(),
                queryIsMemberAgent,
            )
        val page = PageDTO(pageStart = 0, pageSize = chats.size, hasPrev = false, hasMore = false)
        return ResponseEntity.ok(ListChatsResponseDTO(chats = chats, page = page))
    }

    @Guard("add-team-chat", "team")
    override fun addTeamChat(
        @PathVariable("id") @ResourceId id: IdType,
        @AuthInfo("teamChat") teamChatRequestDTO: TeamChatRequestDTO?,
    ): ResponseEntity<ThreadDTO> {
        val dto = teamChatRequestDTO ?: return ResponseEntity.badRequest().build()
        val threadId =
            dto.threadId
                ?: threadService
                    .createThread(
                        currentUserId(),
                        CreateThreadRequestDTO(
                            title =
                                dto.title ?: throw BadRequestError("give a threadId or a title"),
                            memberIds = dto.memberIds,
                        ),
                    )
                    .id
        teamChatService.place(id, threadId)
        return ResponseEntity.ok(threadService.getThread(threadId, currentUserId()).thread)
    }

    @Guard("remove-team-chat", "team")
    override fun removeTeamChat(
        @PathVariable("id") @ResourceId id: IdType,
        @PathVariable("threadId") threadId: IdType,
    ): ResponseEntity<Unit> {
        teamChatService.unplace(id, threadId)
        return ResponseEntity(HttpStatus.NO_CONTENT)
    }

    // -- Machines in this team (enumerate via GET /machine?teamId=) ----------

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
            documentService.getDocument(id, path, recursive, content, history, diff),
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
            documentService.writeDocument(id, path, body ?: "", currentUserId()),
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
            documentService.moveDocument(id, path, moveDocumentRequestDTO.newPath, currentUserId()),
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
