/*
 *  Description: Whether a machine is connected, as a row: machine_link holds one row per machine
 *               whose control channel is attached to this backend.
 *
 *               It is a row rather than only the hub's memory so that "online" is data like any
 *               other: a screen that shows it is answered from the same database as everything else
 *               it shows, and changes when the row does (live requests, see the live module). The
 *               hub stays the authority on the channel itself; this table mirrors it, written where
 *               the channel comes up and goes down (LinkHandler), and emptied when the backend
 *               starts, because a new backend process holds no channels.
 *
 *               MachineLink / MachineLinkRepository — the row and its repository.
 *               MachinePresence (a Spring bean):
 *                 connected(machineId, origin) — the machine's hello was accepted.
 *                 disconnected(machineId) — its channel closed.
 *                 isOnline(machineId) -> Boolean; online(machineIds) -> the subset that is.
 *
 *               Example: presence.connected("m1", "https://line.example"); presence.isOnline("m1")
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime
import org.springframework.boot.context.event.ApplicationStartedEvent
import org.springframework.context.event.EventListener
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Entity
@Table(name = "machine_link")
class MachineLink(
    @Id @Column(name = "machine_id", length = 64) var machineId: String = "",
    @Column(name = "connected_at", nullable = false)
    var connectedAt: LocalDateTime = LocalDateTime.now(),
    @Column(name = "origin") var origin: String? = null,
)

interface MachineLinkRepository : JpaRepository<MachineLink, String> {
    // Native and unconditional, because connects and disconnects of one machine race (a reconnect
    // overlaps the old channel's close): neither may depend on what the other left behind.
    @Modifying
    @Query(
        value =
            "INSERT INTO microteams.machine_link (machine_id, connected_at, origin) VALUES (:id, now(), :origin) " +
                "ON CONFLICT (machine_id) DO UPDATE SET connected_at = now(), origin = :origin",
        nativeQuery = true,
    )
    fun upsert(@Param("id") machineId: String, @Param("origin") origin: String?)

    @Modifying
    @Query(value = "DELETE FROM microteams.machine_link WHERE machine_id = :id", nativeQuery = true)
    fun remove(@Param("id") machineId: String)
}

@Service
@Transactional
class MachinePresence(private val links: MachineLinkRepository) {
    @EventListener(ApplicationStartedEvent::class)
    fun clear() {
        links.deleteAllInBatch()
    }

    fun connected(machineId: String, origin: String?) {
        links.upsert(machineId, origin)
    }

    fun disconnected(machineId: String) {
        links.remove(machineId)
    }

    @Transactional(readOnly = true)
    fun isOnline(machineId: String): Boolean = links.existsById(machineId)

    @Transactional(readOnly = true)
    fun online(machineIds: Collection<String>): Set<String> =
        links.findAllById(machineIds).map { it.machineId }.toSet()
}
