/*
 *  Description: Records which tables a request reads, from the SQL Hibernate sends.
 *
 *               Every statement the backend runs passes through Hibernate, entity queries and native
 *               ones alike, so inspecting the SQL text is the one place where every read is seen.
 *               The tables named after FROM and JOIN are recorded as sources (see Sources.kt); the
 *               statement itself is returned unchanged.
 *
 *               A table is named without its schema and without quotes ("user", "message"), the same
 *               spelling the change trigger reports, so a read and a change of the same table match.
 *
 *               Registered with Hibernate by class name
 *               (hibernate.session_factory.statement_inspector in application.properties), which is
 *               why it has a no-argument constructor and no Spring dependencies.
 *
 *               SqlSourceInspector.tablesOf(sql) -> Set<String> — the tables a statement names.
 *
 *               Example: tablesOf("select m1_0.id from microteams.message m1_0") == setOf("message")
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.common.live

import org.hibernate.resource.jdbc.spi.StatementInspector

class SqlSourceInspector : StatementInspector {
    override fun inspect(sql: String): String {
        for (table in tablesOf(sql)) ReadSources.touch(table)
        return sql
    }

    companion object {
        private val TABLE =
            Regex(
                """\b(?:from|join|update|into)\s+(?:"?(\w+)"?\.)?"?(\w+)"?""",
                RegexOption.IGNORE_CASE,
            )

        fun tablesOf(sql: String): Set<String> =
            TABLE.findAll(sql)
                .map { it.groupValues[2].lowercase() }
                .filter { it != "select" && it != "lateral" }
                .toSet()
    }
}
