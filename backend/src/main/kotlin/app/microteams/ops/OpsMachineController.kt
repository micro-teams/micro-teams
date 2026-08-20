/*
 *  Description: The operator surface: look at the machines, and push one of them an update.
 *
 *               Named reads and named actions only. The temptation with an operator API is a
 *               general query endpoint — "so I do not have to open the database" — but a general
 *               read endpoint IS the database, on the network, with one secret in front of it. Each
 *               thing worth looking at gets its own endpoint, so adding one is a decision somebody
 *               made rather than a capability nobody noticed granting.
 *
 *               The one idea this whole file rests on: A PUSH IS A REQUEST, NOT A RESULT. The
 *               update endpoint hands a message to a machine that then replaces its own process; it
 *               cannot know, and must never claim, that the machine came back on the new build.
 *               What it returns is what it did and what the machine was running at the time. The
 *               operator then LOOKS — the machine drops, reconnects, and reports a build — which is
 *               why version reporting had to exist before this endpoint could be honest.
 *
 *               An offline machine is refused rather than queued. A queued update fires at some
 *               unpredictable later moment, possibly days after the person who asked for it stopped
 *               watching, which is worse than a clean failure.
 *
 *               Deliberately no batch endpoint. The failure mode of a forced update is that a bad
 *               binary does not come back, and a batch is how one bad binary takes out everything
 *               at once. One machine, watch it return, decide.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ops

import app.microteams.machine.enrollment.MachineRepository
import app.microteams.machine.link.MachineHub
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** What an operator can see about one machine. */
data class OpsMachine(
    val id: String,
    val name: String?,
    val online: Boolean,
    /**
     * The connector build it reported, or null for "has not said" — never assume that means old.
     */
    val build: String?,
    val connectedAt: String?,
    val screens: Int,
    /** When an update was last asked for, and what it was running then. */
    val updateRequestedAt: String?,
    val buildWhenRequested: String?,
)

data class OpsUpdateResult(
    /** Always "requested". This endpoint cannot observe an outcome — see the file header. */
    val outcome: String,
    val machineId: String,
    val buildBefore: String?,
    val requestedAt: String,
    val note: String,
)

@RestController
@RequestMapping("/ops")
class OpsMachineController(
    private val hub: MachineHub,
    private val machineRepository: MachineRepository,
) {
    private val logger = LoggerFactory.getLogger(OpsMachineController::class.java)

    private data class Requested(val at: Instant, val build: String?)

    private val requested = ConcurrentHashMap<String, Requested>()

    /**
     * How soon the same machine may be pushed again. Stops a double-click becoming two re-execs.
     */
    private val cooldown = Duration.ofMinutes(2)

    @GetMapping("/machines")
    fun machines(): List<OpsMachine> =
        machineRepository.findAll().map { machine ->
            val id = machine.machineId
            val ask = requested[id]
            OpsMachine(
                id = id,
                name = machine.name,
                online = hub.isOnline(id),
                build = hub.buildOf(id),
                connectedAt = hub.connectedAtOf(id)?.toString(),
                screens = hub.screensOf(id),
                updateRequestedAt = ask?.at?.toString(),
                buildWhenRequested = ask?.build,
            )
        }

    @PostMapping("/machines/{id}/update")
    fun update(@PathVariable id: String): ResponseEntity<Any> {
        if (machineRepository.findById(id).isEmpty) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(mapOf("error" to "no such machine"))
        }
        if (!hub.isOnline(id)) {
            // Not queued on purpose: an update that fires days later, long after whoever asked for
            // it stopped watching, is worse than a failure you can see.
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(mapOf("error" to "machine is offline; nothing was sent"))
        }
        val previous = requested[id]
        val now = Instant.now()
        if (previous != null && Duration.between(previous.at, now) < cooldown) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(
                    mapOf(
                        "error" to "an update was already requested for this machine",
                        "requestedAt" to previous.at.toString(),
                    )
                )
        }
        val before = hub.buildOf(id)
        hub.sendUpdate(id)
        requested[id] = Requested(now, before)
        logger.warn(
            "ops: update requested for machine {} (was on build {})",
            id,
            before ?: "unknown",
        )
        return ResponseEntity.ok(
            OpsUpdateResult(
                outcome = "requested",
                machineId = id,
                buildBefore = before,
                requestedAt = now.toString(),
                note =
                    "The machine was asked to update. Whether it did is only knowable by looking: " +
                        "watch it drop, reconnect, and report a build. GET /ops/machines.",
            )
        )
    }
}
