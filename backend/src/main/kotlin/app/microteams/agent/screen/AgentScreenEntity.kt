/*
 *  Description: This file defines the AgentScreen entity and its repository — the mapping from a
 *               machine's screen (sid) to the agent running on it. The machine layer deliberately
 *               does not know this: to it a screen is a hosted process of some opaque kind, and
 *               these rows are how the agent module recognises its own.
 *
 *               It is persisted so that after a server restart we can re-adopt the screens the
 *               auto-reconnecting machine still has running. The row carries the agent's user id
 *               (agent = a real user), the team it runs in, the screen token used to attribute
 *               its tool calls, and which driver it runs so a resume relaunches the same program.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent.screen

import jakarta.persistence.*
import java.time.LocalDateTime
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(
    name = "agent_screen",
    indexes = [Index(columnList = "machine_id"), Index(columnList = "agent_user_id")],
)
class AgentScreen(
    @Id @Column(length = 32) var sid: String = "",
    @Column(name = "machine_id", nullable = false, length = 64) var machineId: String = "",
    // The screen token (a secret injected as MICROTEAMS_SCREEN); paired with the machine
    // token it attributes a tool call to this agent.
    @Column(nullable = false, length = 64) var token: String = "",
    @Column(name = "team_id") var teamId: IdType? = null,
    @Column(name = "agent_user_id", nullable = false) var agentUserId: IdType = 0,
    // The session id we minted for the driven program, so a resume continues its transcript.
    @Column(name = "session_id", length = 64) var sessionId: String? = null,
    @Column(length = 1024) var cwd: String? = null,
    @Column(nullable = false, length = 32) var driver: String = "claude",
    @Column(name = "created_at", nullable = false)
    var createdAt: LocalDateTime = LocalDateTime.now(),
)

interface AgentScreenRepository : JpaRepository<AgentScreen, String> {
    fun findByMachineId(machineId: String): List<AgentScreen>

    fun findByAgentUserId(agentUserId: IdType): List<AgentScreen>

    fun deleteByMachineId(machineId: String)
}
