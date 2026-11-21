/*
 *  Description: What a request read, and what changed: the two facts live requests are built on.
 *
 *               A live request (see the live module) is an ordinary GET that is answered again
 *               whenever its answer would differ. The backend cannot know whether an answer differs
 *               without running the request again, but it can know which data an answer was made
 *               from and when that data changes. A "source" names such data at the granularity a
 *               change is reported at: a table name ("message", "team_member"), a team's document
 *               tree ("git:12"), or the machine hub's in-memory screen state ("hub").
 *
 *               Reads are recorded where they happen (the SQL inspector, the git layer, the hub),
 *               never by business code, so a feature cannot forget to declare what it reads. Changes
 *               come from the database itself (a trigger on every table) and from the same layers,
 *               so a feature cannot forget to announce what it wrote either.
 *
 *               ReadSources (thread-local, a no-op unless a recording is active on this thread):
 *                 record(block) -> Pair(result, sources) — run block, collecting what it read.
 *                 touch(source) — note that the current recording read source.
 *               ChangeBus (a Spring bean):
 *                 publish(source) — source changed; "*" means anything may have changed.
 *                 subscribe(listener) -> AutoCloseable — be told every published source.
 *
 *               Example:
 *                 val (body, read) = ReadSources.record { controller.list() }
 *                 bus.subscribe { source -> if (source in read) rerun() }
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.common.live

import java.util.concurrent.CopyOnWriteArrayList
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** Everything that may have changed: what a lost notification channel stands for. */
const val ANY_SOURCE = "*"

object ReadSources {
    private val current = ThreadLocal<MutableSet<String>?>()

    fun <T> record(block: () -> T): Pair<T, Set<String>> {
        val outer = current.get()
        val mine = linkedSetOf<String>()
        current.set(mine)
        try {
            return block() to mine
        } finally {
            current.set(outer)
            outer?.addAll(mine)
        }
    }

    fun touch(source: String) {
        current.get()?.add(source)
    }
}

@Component
class ChangeBus {
    private val logger = LoggerFactory.getLogger(ChangeBus::class.java)
    private val listeners = CopyOnWriteArrayList<(String) -> Unit>()

    fun publish(source: String) {
        for (l in listeners) {
            try {
                l(source)
            } catch (e: Exception) {
                logger.warn("change bus: a listener failed on {}: {}", source, e.toString())
            }
        }
    }

    fun subscribe(listener: (String) -> Unit): AutoCloseable {
        listeners.add(listener)
        return AutoCloseable { listeners.remove(listener) }
    }
}
