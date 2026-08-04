/*
 *  Description: An agent's cache-keepalive schedule — the durable half of the keepalive feature.
 *
 *               Claude Code caches an agent's whole context (system prompt, tools, transcript) and
 *               gives that cache a ~1h TTL that every use refreshes. Reading the cache back is
 *               nearly free against the account's rolling-window quota; rebuilding it after it
 *               lapses is a large one-off write. So an agent that sits idle for over an hour pays a
 *               heavy quota bill the next time anyone talks to it, purely for having gone quiet.
 *
 *               Keepalive avoids that: while enabled, the server periodically types a do-nothing
 *               message into the agent's program, which is a cheap cache-read turn that pushes the
 *               TTL out another hour. The economically important property is that it must NOT stop
 *               firing across a backend restart — a missed touch can be the one that lets the cache
 *               lapse, costing real quota. An in-memory countdown resets on every restart and would
 *               drift or skip; instead the NEXT fire time lives in this row, so after a restart the
 *               poller simply reads it back and continues where it left off (firing immediately if
 *               the moment already passed while we were down).
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.time.Instant
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository

@Entity
@Table(name = "agent_keepalive", indexes = [Index(columnList = "enabled, next_fire_at")])
class AgentKeepalive(
    // The agent (a real user) whose cache this keeps warm — one schedule per agent.
    @Id @Column(name = "agent_user_id") var agentUserId: IdType = 0,
    @Column(nullable = false) var enabled: Boolean = false,
    // Seconds between touches. Kept even while disabled so re-enabling remembers the last choice.
    @Column(name = "interval_seconds", nullable = false) var intervalSeconds: Long = 0,
    // When the next touch is due. The single source of truth the poller reads, so the schedule
    // survives restarts intact; null exactly when disabled (nothing is due).
    @Column(name = "next_fire_at") var nextFireAt: Instant? = null,
    // When the last touch actually went out — diagnostic only.
    @Column(name = "last_fire_at") var lastFireAt: Instant? = null,
)

interface AgentKeepaliveRepository : JpaRepository<AgentKeepalive, IdType> {
    /** The schedules that are on and due right now — the poller's whole working set. */
    fun findByEnabledTrueAndNextFireAtLessThanEqual(now: Instant): List<AgentKeepalive>
}
