/*
 *  Description: This file implements the RolePermissionService class — the whole business
 *               authorization model of this backend, in one table.
 *
 *               That claim is the point, and it only holds if two rules are kept absolutely:
 *
 *                 1. Authorization code has no business logic. Every clause below is an atomic,
 *                    named predicate whose meaning is obvious from its name; each is registered in
 *                    the @PostConstruct of the controller that owns the concept, and does nothing
 *                    but turn (userId, authInfo) into one true/false fact.
 *                 2. Business code has no authorization. No service throws ForbiddenError and no
 *                    service filters by "may this user...". If a rule is not visible here, it does
 *                    not exist — an auditor must never have to read a service to learn who may do
 *                    what.
 *
 *               Actions are named after what the endpoint *does* ("rename-machine", "watch",
 *               "post-message"), not after CRUD, so a row reads as the permission of a specific
 *               endpoint rather than of a vague verb. customLogic is a boolean expression over
 *               those predicates (&&, ||, !, parens — see CustomAuthLogics), so a rule with several
 *               ways to be satisfied stays one readable row instead of being smeared across
 *               several permissions.
 *
 *               A permission grants an action when all of its clauses match; the matrix grants it
 *               when any permission does.
 *
 *               The model the rows express: everyone who can access a team (a member of it, or of
 *               a team containing it) may use everything in it — its documents, machines, chats and
 *               agents — and there are no roles. Access grows only by the placement rule: a thing
 *               is put somewhere only by someone who can already access both the thing and the
 *               place. Removing is open to anyone who can access the place, and anyone may leave.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *      nameisyui
 *
 */

package app.microteams.user

import org.rucca.cheese.auth.Authorization
import org.rucca.cheese.auth.AuthorizedResource
import org.rucca.cheese.auth.Permission
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

@Service
class RolePermissionService {
    fun getAuthorizationForUserWithRole(userId: IdType, role: String): Authorization {
        return when (role) {
            "standard-user" -> getAuthorizationForStandardUser(userId)
            else -> throw IllegalArgumentException("Role '$role' is not supported")
        }
    }

    fun getAuthorizationForStandardUser(userId: IdType): Authorization {
        fun p(actions: List<String>, type: String, logic: String? = null) =
            Permission(
                authorizedActions = actions,
                authorizedResource = AuthorizedResource(types = listOf(type)),
                customLogic = logic,
            )
        return Authorization(
            userId = userId,
            permissions =
                listOf(
                    // Minimal auth-chain smoke-test endpoint.
                    p(listOf("query"), "ping"),

                    // -- Chat --------------------------------------------------------------

                    // GET /chat — the query only ever returns the caller's own memberships.
                    p(listOf("enumerate-my-chats"), "chat_thread"),
                    // POST /chat — a thread in no team; its initial members may include an agent
                    // only if the caller can access that agent (the placement rule).
                    p(listOf("create-chat"), "chat_thread", "initial-members-are-accessible"),
                    // GET /chat/{id}, its members, its messages; POST /chat/{id}/join — reading
                    // needs no membership: a member, or anyone who can access one of its teams.
                    p(
                        listOf("query-chat", "enumerate-chat-members", "join-chat"),
                        "chat_thread",
                        "can-read-thread",
                    ),
                    p(listOf("enumerate-messages"), "chat_message", "can-read-thread"),
                    // Speaking and changing the thread need membership. Agents post through the
                    // same row: the tool-door authenticates them and asks this matrix as the agent.
                    p(listOf("post-message"), "chat_message", "is-thread-member"),
                    p(listOf("rename-chat", "dissolve-chat"), "chat_thread", "is-thread-member"),
                    p(
                        listOf("add-chat-member"),
                        "chat_thread",
                        "is-thread-member && added-user-is-accessible",
                    ),
                    p(
                        listOf("remove-chat-member"),
                        "chat_thread",
                        "is-thread-member || is-removing-self",
                    ),

                    // -- Teams -------------------------------------------------------------

                    // GET /team is self-scoping; POST /team inside a parent needs the parent.
                    p(listOf("enumerate-my-teams"), "team"),
                    p(listOf("create-team"), "team", "can-access-parent-team"),
                    p(
                        listOf(
                            "query-team",
                            "enumerate-team-members",
                            "rename-team",
                            "delete-team",
                            "remove-subteam",
                            "enumerate-team-chats",
                            "remove-team-chat",
                            "unbind-machine-from-team",
                        ),
                        "team",
                        "can-access-team",
                    ),
                    p(
                        listOf("add-team-member"),
                        "team",
                        "can-access-team && added-user-is-accessible",
                    ),
                    p(listOf("remove-team-member"), "team", "can-access-team || is-removing-self"),
                    p(listOf("add-subteam"), "team", "can-access-team && can-access-nested-team"),
                    p(
                        listOf("add-team-chat"),
                        "team",
                        "can-access-team && can-read-placed-thread && initial-members-are-accessible",
                    ),
                    p(
                        listOf("bind-machine-to-team"),
                        "team",
                        "can-access-team && can-access-bound-machine",
                    ),
                    p(
                        listOf(
                            "read-document",
                            "write-document",
                            "move-document",
                            "delete-document",
                        ),
                        "team_document",
                        "can-access-team",
                    ),

                    // -- Machines ----------------------------------------------------------

                    // POST /machine/enroll/approve — only into teams the caller can access.
                    // (start/poll are @NoAuth: the machine has no identity yet.)
                    p(listOf("approve-enrollment"), "machine", "can-access-every-enrolled-team"),
                    // GET /machine — scoped to a team the caller can access, or unscoped, which by
                    // definition means the machines the caller can use.
                    p(
                        listOf("enumerate-machines"),
                        "machine",
                        "can-access-queried-team || is-enumerating-own-machines",
                    ),
                    // The machine itself, its terminals and its commands: whoever can use it.
                    p(
                        listOf(
                            "query-machine",
                            "rename-machine",
                            "forget-machine",
                            "enumerate-terminals",
                            "open-terminal",
                            "query-terminal",
                            "close-terminal",
                        ),
                        "machine",
                        "can-access-machine",
                    ),
                    // Watching a screen: whoever can use the machine it runs on, resolved from
                    // memory or, for an agent's screen the server has forgotten, from its row.
                    p(
                        listOf("watch"),
                        "machine_screen",
                        "can-access-screen-machine || can-access-agent-screen-machine",
                    ),

                    // -- Agents ------------------------------------------------------------

                    // GET /agent backs every avatar and discloses nothing privileged: the screen id
                    // is attached only where `watch` allows it. The driver list is not privileged.
                    p(listOf("enumerate-agents", "list-drivers"), "agent"),
                    // POST /agent — the team it joins and the machine it runs on, both accessible.
                    p(
                        listOf("open-agent"),
                        "agent",
                        "can-access-target-team && can-access-target-machine",
                    ),
                    // Operating an existing agent: whoever can access it.
                    p(
                        listOf(
                            "close-agent",
                            "reboot-agent",
                            "change-agent-avatar",
                            "change-agent-nickname",
                            "change-agent-keepalive",
                            "change-agent-llm",
                        ),
                        "agent",
                        "can-access-agent",
                    ),
                ),
        )
    }
}
