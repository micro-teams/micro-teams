/*
 *  Description: Turns every committed write to a table the backend maps into a change on the
 *               ChangeBus, using the database's own notification, so no business code ever has to
 *               announce a write.
 *
 *               At startup it installs one trigger function, microteams.notify_change(), and on
 *               every table an entity maps (both schemas: our own, and the identity service's tables
 *               we mirror) one statement-level trigger calling it. The function sends the table's
 *               name on the channel mt_change. NOTIFY is transactional: a listener hears it only
 *               after the writing transaction commits, so a rerun always sees the write.
 *
 *               Installing is idempotent (CREATE OR REPLACE), so every boot makes the schema hold
 *               the triggers whatever state it was in. If they cannot be installed the backend does
 *               not start: a backend without them would serve answers that silently stop changing.
 *
 *               One daemon thread holds a dedicated connection that LISTENs and publishes each
 *               notification's table. When that connection breaks it publishes ANY_SOURCE (what was
 *               missed is unknown) and opens a new one.
 *
 *               TableChanges(dataSource, entityManagerFactory, bus) — a Spring bean; nothing to call.
 *               TableChanges.TRIGGER_SQL — the function, as the migration file also lists it.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.live

import app.microteams.common.live.ANY_SOURCE
import app.microteams.common.live.ChangeBus
import jakarta.annotation.PreDestroy
import jakarta.persistence.EntityManagerFactory
import javax.sql.DataSource
import org.hibernate.engine.spi.SessionFactoryImplementor
import org.hibernate.persister.entity.AbstractEntityPersister
import org.postgresql.PGConnection
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationStartedEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component

@Component
class TableChanges(
    private val dataSource: DataSource,
    private val entityManagerFactory: EntityManagerFactory,
    private val bus: ChangeBus,
) {
    private val logger = LoggerFactory.getLogger(TableChanges::class.java)

    @Volatile private var running = true

    @EventListener(ApplicationStartedEvent::class)
    fun start() {
        install()
        Thread({ listen() }, "table-changes").apply { isDaemon = true }.start()
    }

    @PreDestroy
    fun stop() {
        running = false
    }

    /** Every table an entity maps, schema-qualified and quoted. */
    private fun tables(): List<String> {
        val metamodel =
            entityManagerFactory.unwrap(SessionFactoryImplementor::class.java).mappingMetamodel
        val names = linkedSetOf<String>()
        metamodel.forEachEntityDescriptor { d ->
            val table = (d as AbstractEntityPersister).tableName
            val parts = table.split('.')
            val qualified = if (parts.size == 1) listOf("microteams", parts[0]) else parts
            names.add(qualified.joinToString(".") { "\"" + it.trim('"') + "\"" })
        }
        return names.toList()
    }

    private fun install() {
        val tables = tables()
        dataSource.connection.use { c ->
            c.createStatement().use { st ->
                st.execute(TRIGGER_SQL)
                for (t in tables) {
                    st.execute(
                        "CREATE OR REPLACE TRIGGER mt_notify_change AFTER INSERT OR UPDATE OR " +
                            "DELETE OR TRUNCATE ON $t FOR EACH STATEMENT EXECUTE FUNCTION " +
                            "microteams.notify_change()",
                    )
                }
            }
        }
        logger.info("table changes: notify trigger on {} tables", tables.size)
    }

    private fun listen() {
        while (running) {
            try {
                dataSource.connection.use { c ->
                    c.createStatement().use { it.execute("LISTEN mt_change") }
                    val pg = c.unwrap(PGConnection::class.java)
                    bus.publish(ANY_SOURCE)
                    while (running) {
                        pg.getNotifications(1000)?.forEach { bus.publish(it.parameter) }
                    }
                }
            } catch (e: Exception) {
                if (!running) return
                logger.warn("table changes: listening failed, listening again: {}", e.toString())
                bus.publish(ANY_SOURCE)
                Thread.sleep(1000)
            }
        }
    }

    companion object {
        const val TRIGGER_SQL =
            "CREATE OR REPLACE FUNCTION microteams.notify_change() RETURNS trigger " +
                "LANGUAGE plpgsql AS \$\$ BEGIN PERFORM pg_notify('mt_change', TG_TABLE_NAME); " +
                "RETURN NULL; END \$\$"
    }
}
