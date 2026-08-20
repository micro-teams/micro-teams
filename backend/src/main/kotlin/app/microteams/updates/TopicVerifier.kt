/*
 *  Description: The thing that makes silence mean something.
 *
 *               Every other mechanism in this package assumes events get published. A heartbeat
 *               proves the socket is alive. A `prev` chain proves no frame was lost in transit. A
 *               ring proves a reconnect can be caught up. None of them can see the failure this
 *               codebase is actually prone to: a write that happened while nobody emitted an event
 *               for it — a mapping nobody wrote, a bulk update that bypasses entity events, a
 *               predicate that filters out the people who should have been told. In that case our
 *               cursor never moved either, so every chain stays perfectly consistent and every
 *               health check is green while the screen quietly shows stale data.
 *
 *               So periodically, for the topics someone is actually watching, this asks the DATA
 *               SOURCE what the answer should be and tells the browsers. A client whose own copy
 *               disagrees refetches — and says so out loud, because a disagreement is a bug report.
 *               That is the whole difference from a poll: a poll silently repairs the symptom and
 *               tells nobody, this names the topic that was wrong.
 *
 *               Deliberately cheap. Only topics with subscribers are asked; the answer is computed
 *               once per topic and sent to everyone watching it; a query that cannot answer right
 *               now says nothing rather than claiming agreement. Nothing here is on a request path.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.updates

import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class TopicVerifier(private val registry: UpdatesRegistry, private val catalog: TopicCatalog) {

    private val logger = LoggerFactory.getLogger(TopicVerifier::class.java)

    /**
     * Every 30 seconds. Slow enough to be free, fast enough that a topic which stopped publishing
     * is noticed while someone is still looking at it.
     */
    @Scheduled(fixedDelayString = "\${application.updates.verify-interval-ms:30000}")
    fun verify() {
        for (name in registry.activeTopics()) {
            val topic = catalog.parse(name) ?: continue
            val state =
                try {
                    catalog.digest(topic)
                } catch (e: Exception) {
                    // Cannot answer is not the same as no change; stay quiet.
                    logger.debug("updates: cannot verify {}: {}", name, e.toString())
                    null
                } ?: continue

            // Our own record of this topic can be behind the truth in two ways: we restarted and
            // remember nothing, or an event was never published. Both are fixed by believing the
            // data source, and the second one is worth saying out loud — nothing else in the system
            // will ever mention it.
            val known = registry.cursorOf(name)
            if (known == null) {
                registry.seedCursor(name, state.seq)
            } else if (state.seq > known) {
                logger.warn(
                    "updates: {} is at {} but we only ever published up to {} — an event was not emitted",
                    name,
                    state.seq,
                    known,
                )
                registry.seedCursor(name, state.seq)
            }
            registry.broadcast(name, UpdateFrame.state(name, state.seq, state.digest))
        }
    }
}
