/*
 *  Description: This file implements the MachineService — enrolling a machine (start / approve /
 *               poll), naming it, forgetting it, and resolving its token. It is the machine as a
 *               machine: it knows nothing about agents.
 *
 *               It also performs no authorization. Who may enrol, rename, forget or enumerate a
 *               machine is stated once, in RolePermissionService, and enforced by @Guard before
 *               any of this runs. These methods do what they are told.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.enrollment

import app.microteams.machine.MachineCodeNotFoundError
import app.microteams.machine.MachineForgottenEvent
import app.microteams.machine.MachineNotFoundError
import app.microteams.team.machine.TeamMachineService
import app.microteams.team.membership.TeamService
import java.security.SecureRandom
import java.time.Duration
import java.time.LocalDateTime
import java.util.Base64
import java.util.UUID
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.context.ApplicationEventPublisher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

data class MachineInfo(
    val machineId: String,
    val name: String,
    val teams: List<IdType>,
    val createdAt: String,
)

data class MachinePollResult(
    val status: String,
    val token: String? = null,
    val machineId: String? = null,
    val machineName: String? = null,
)

@Service
@Transactional
class MachineService(
    private val machineRepository: MachineRepository,
    private val machineAuthCodeRepository: MachineAuthCodeRepository,
    private val teamMachineService: TeamMachineService,
    private val teamService: TeamService,
    private val eventPublisher: ApplicationEventPublisher,
) {
    private val random = SecureRandom()
    private val codeTtl = Duration.ofMinutes(10)

    // -- enrollment flow ---------------------------------------------------

    /** Begin a flow; return the opaque code the machine polls on. */
    fun start(machineName: String?): String {
        val code =
            MachineAuthCode(
                code = UUID.randomUUID().toString().replace("-", ""),
                machineName = machineName?.trim().takeUnless { it.isNullOrEmpty() } ?: "unnamed",
                status = MachineCodeStatus.PENDING,
            )
        machineAuthCodeRepository.save(code)
        return code.code
    }

    /**
     * Approve a pending flow on behalf of a logged-in human, binding the machine to [teamIds]
     * (which the actor must be a member of) and minting its durable token. Idempotent: re-approving
     * a code returns the same machine and keeps the bindings.
     */
    fun approve(codeValue: String, teamIds: List<IdType>): MachineInfo {
        if (teamIds.isEmpty()) throw BadRequestError("at least one team is required")
        val entry = liveCode(codeValue)

        val machine =
            if (entry.status == MachineCodeStatus.APPROVED && entry.machineId != null) {
                machineRepository.findById(entry.machineId!!).orElseGet { mintMachine(entry) }
            } else {
                mintMachine(entry).also {
                    entry.status = MachineCodeStatus.APPROVED
                    entry.machineId = it.machineId
                    entry.teamId = teamIds.first()
                    machineAuthCodeRepository.save(entry)
                }
            }
        teamIds.forEach { teamMachineService.bind(machine.machineId, it) }
        return toInfo(machine)
    }

    /** What the polling machine reads: {status}, plus token/identity once approved. */
    fun poll(codeValue: String): MachinePollResult {
        val entry = liveCode(codeValue)
        if (entry.status != MachineCodeStatus.APPROVED || entry.machineId == null) {
            return MachinePollResult(status = entry.status)
        }
        val machine =
            machineRepository.findById(entry.machineId!!).orElse(null)
                ?: return MachinePollResult(status = MachineCodeStatus.PENDING)
        return MachinePollResult(
            status = MachineCodeStatus.APPROVED,
            token = machine.token,
            machineId = machine.machineId,
            machineName = machine.name,
        )
    }

    private fun mintMachine(entry: MachineAuthCode): Machine =
        machineRepository.save(
            Machine(
                machineId = UUID.randomUUID().toString().replace("-", "").take(12),
                name = entry.machineName,
                token = randomToken(24),
            )
        )

    private fun liveCode(codeValue: String): MachineAuthCode {
        val entry =
            machineAuthCodeRepository.findById(codeValue).orElseThrow { MachineCodeNotFoundError() }
        if (Duration.between(entry.createdAt, LocalDateTime.now()) > codeTtl) {
            throw MachineCodeNotFoundError()
        }
        return entry
    }

    // -- the machines themselves -------------------------------------------

    /**
     * The one machine enumeration, narrowed by the given filters — a new way to slice machines is a
     * new filter here rather than a new endpoint. [online] is resolved by the caller (only the hub
     * knows), which is why it is a predicate rather than a flag.
     *
     * Both shapes are self-scoping, which is why this needs no permission check of its own and the
     * matrix can gate the *query* instead: scoped to a team, it returns that team's machines (and
     * `is-member-of-queried-team` says whether you may ask); unscoped, it returns the machines of
     * teams [actorUserId] belongs to, which is the definition of the query, not a filter applied to
     * a wider answer.
     */
    fun list(
        actorUserId: IdType,
        teamId: IdType?,
        online: Boolean?,
        isOnline: (String) -> Boolean,
    ): List<MachineInfo> {
        val ids =
            if (teamId != null) {
                teamMachineService.machineIdsOf(teamId).toSet()
            } else {
                machineRepository
                    .findAll()
                    .map { it.machineId }
                    .filter { teamMachineService.mayAccess(actorUserId, it) }
                    .toSet()
            }
        return machineRepository
            .findAllById(ids)
            .filter { online == null || isOnline(it.machineId) == online }
            .sortedBy { it.createdAt }
            .map { toInfo(it) }
    }

    fun get(machineId: String): MachineInfo = toInfo(machine(machineId))

    fun rename(machineId: String, name: String): MachineInfo {
        val machine = machine(machineId)
        val clean = name.trim()
        if (clean.isEmpty()) throw BadRequestError("machine name must not be empty")
        machine.name = clean
        return toInfo(machineRepository.save(machine))
    }

    /** Forget the machine outright — its bindings, its token, and whatever ran on it. */
    fun forget(machineId: String) {
        machine(machineId) // 404 rather than a silent no-op
        forgetInternal(machineId)
    }

    private fun forgetInternal(machineId: String) {
        teamMachineService.unbindAll(machineId)
        machineRepository.deleteById(machineId)
        // Whoever hosted something here cleans it up; we must not reach into their tables.
        eventPublisher.publishEvent(MachineForgottenEvent(machineId))
    }

    /** Bind a machine to one more team. */
    fun bindToTeam(machineId: String, targetTeamId: IdType) {
        machine(machineId) // 404 if the machine does not exist
        teamService.getTeam(targetTeamId) // 404 if the target team does not exist
        teamMachineService.bind(machineId, targetTeamId)
    }

    /**
     * Remove a team's binding (its own or another's — symmetric). If that was the last one the
     * machine is orphaned and nobody could ever reach it again, so it is forgotten outright.
     */
    fun unbindFromTeam(machineId: String, teamId: IdType) {
        machine(machineId)
        teamMachineService.unbind(machineId, teamId)
        if (teamMachineService.isOrphaned(machineId)) forgetInternal(machineId)
    }

    // -- token resolution --------------------------------------------------

    fun verifyToken(token: String): Machine? =
        if (token.isBlank()) null else machineRepository.findByToken(token).orElse(null)

    /**
     * The machine's durable token (injected into a screen as MICROTEAMS_TOKEN for its
     * microteams-api calls).
     */
    fun tokenOf(machineId: String): String? =
        machineRepository.findById(machineId).map { it.token }.orElse(null)

    // -- helpers -----------------------------------------------------------

    private fun machine(machineId: String): Machine =
        machineRepository.findById(machineId).orElseThrow { MachineNotFoundError(machineId) }

    private fun toInfo(machine: Machine): MachineInfo =
        MachineInfo(
            machineId = machine.machineId,
            name = machine.name,
            teams = teamMachineService.teamsOf(machine.machineId),
            createdAt = machine.createdAt.toString(),
        )

    private fun randomToken(bytes: Int): String {
        val buf = ByteArray(bytes)
        random.nextBytes(buf)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf)
    }
}
