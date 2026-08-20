/*
 *  Description: The `team:{id}` synced query — the machines serving a team, the agents open on
 *               them, and which of them are alive right now.
 *
 *               This is the topic that justifies the whole "digest asked of the source" rule,
 *               because most of what it reports is not in any database row. Whether a machine is
 *               online is a live transport in MachineHub; whether an agent's program is alive is a
 *               screen state held in memory. There is no id to count and no updated-at to compare,
 *               so its cursor is a plain counter that steps whenever something changes, and its
 *               digest is a description of the current answer.
 *
 *               WHAT THE DIGEST DETECTS: how many machines serve the team, how many of those are
 *               connected, and how many agent screens exist. So a machine connecting or dropping, a
 *               device being bound or unbound, and an agent being opened or closed all show up.
 *
 *               What it deliberately leaves out is whether each agent's PROGRAM is alive. The
 *               browser is told that as `Agent.online`, which is a different question with a
 *               different answer (see AgentController.toDTO — it is true for an agent on a
 *               connected machine even before its screen reports LIVE). Digesting our own notion of
 *               liveness against the browser's notion would disagree constantly and by design,
 *               producing a stream of false alarms — worse than not checking, because an alarm
 *               nobody can trust gets ignored when it is finally right. Reproducing that rule here
 *               instead would put a business decision inside the push layer, which is the one thing
 *               this package must not do.
 *
 *               So liveness still reaches the screen — a screen changing state publishes an event
 *               and the list refetches — it is simply not part of what the periodic check verifies.
 *               A change that leaves all three counts identical (one agent dying as another is
 *               revived) resolves at the next event or the next refocus.
 *
 *               Liveness reaches us through MachineHub's existing lifecycle seam rather than
 *               anything new: the machine layer publishes that a screen changed state, and this
 *               translates that into "the team's answer moved". The machine layer stays unaware of
 *               topics, exactly like chat.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates.map

import app.microteams.agent.screen.AgentScreenRepository
import app.microteams.machine.link.MachineHub
import app.microteams.team.machine.TeamMachineService
import app.microteams.team.membership.TeamService
import app.microteams.updates.SyncedQuery
import app.microteams.updates.Topic
import app.microteams.updates.TopicState
import app.microteams.updates.UpdateKind
import app.microteams.updates.UpdatesRegistry
import jakarta.annotation.PostConstruct
import java.util.concurrent.atomic.AtomicLong
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Component
class TeamQuery(
    private val registry: UpdatesRegistry,
    private val hub: MachineHub,
    private val agentScreenRepository: AgentScreenRepository,
    private val teamMachineService: TeamMachineService,
    private val teamService: TeamService,
) : SyncedQuery<Topic.Team> {

    private val logger = LoggerFactory.getLogger(TeamQuery::class.java)

    /**
     * Nothing here has an id to count along, so the cursor is a counter of our own. It only has to
     * be monotonic — the client uses it to notice it missed something, never to fetch by it.
     */
    private val tick = AtomicLong(0)

    override val prefix = Topic.Team.PREFIX

    override fun parse(raw: String): Topic.Team? =
        raw.removePrefix(prefix).toLongOrNull()?.let { Topic.Team(it) }

    override fun mayRead(userId: Long, topic: Topic.Team): Boolean =
        teamService.isTeamMember(topic.teamId, userId)

    override fun digest(topic: Topic.Team): TopicState {
        val machineIds = teamMachineService.machineIdsOf(topic.teamId)
        // `hub.isOnline` is exactly what MachineController reports as MachineDTO.online, so the two
        // sides are comparing the same statement rather than two similar-sounding ones.
        val online = machineIds.count { hub.isOnline(it) }
        val screens = machineIds.sumOf { agentScreenRepository.findByMachineId(it).size }
        // The counter, not the contents, is the cursor: a digest that changes tells the client to
        // refetch, and the seq only has to move so a client can tell it missed a step.
        return TopicState(seq = tick.get(), digest = "${machineIds.size}:$online:$screens")
    }

    @PostConstruct
    fun listen() {
        // A screen changing state is the machine layer's own announcement; it knows nothing about
        // topics and must keep knowing nothing.
        hub.addScreenLifecycleListener { screen, _ ->
            try {
                val teams = teamMachineService.teamsOf(screen.machineId)
                for (teamId in teams) {
                    registry.publish(
                        topic = Topic.Team(teamId).name,
                        seq = tick.incrementAndGet(),
                        kind = UpdateKind.TEAM_CHANGED,
                        stillAllowed = { userId -> teamService.isTeamMember(teamId, userId) },
                    )
                }
            } catch (e: Exception) {
                logger.warn("updates: failed publishing team change for {}", screen.machineId, e)
            }
        }
    }
}
