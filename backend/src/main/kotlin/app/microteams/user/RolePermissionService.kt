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

    // The original space/task/ai:quota entries were removed along with the business modules they
    // gated. See ~/work/ref-study/microteams-backend-mt for the full original set — the auth
    // framework
    // itself (AuthorizationService, AuthorizationAspect, the Permission/AuthorizedResource model,
    // custom-logic expressions) is untouched and still the pattern followed here.
    fun getAuthorizationForStandardUser(userId: IdType): Authorization {
        return Authorization(
            userId = userId,
            permissions =
                listOf(
                    // Minimal auth-chain smoke-test endpoint.
                    Permission(
                        authorizedActions = listOf("query"),
                        authorizedResource = AuthorizedResource(types = listOf("ping")),
                    ),

                    // -- Chat: threads -------------------------------------------------

                    // GET /chat — the query only ever returns the caller's own memberships.
                    Permission(
                        authorizedActions = listOf("enumerate-my-chats"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                    ),
                    // POST /chat — anyone may start a group, but the initial memberIds may not
                    // include an agent whose team the caller is outside of (otherwise anyone could
                    // pull any team's agent into a group they run). Adding humans stays open.
                    Permission(
                        authorizedActions = listOf("create-chat"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                        customLogic = "no-foreign-agent-in-created-thread",
                    ),
                    // GET /chat/{id}, GET /chat/{id}/members
                    Permission(
                        authorizedActions = listOf("query-chat", "enumerate-chat-members"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                        customLogic = "is-thread-member",
                    ),
                    // PATCH /chat/{id}, DELETE|PATCH /chat/{id}/members/...
                    Permission(
                        authorizedActions =
                            listOf("rename-chat", "remove-chat-member", "change-chat-member-role"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                        customLogic = "is-thread-admin",
                    ),
                    // POST /chat/{id}/members — a thread admin may add members, but may not pull in
                    // an agent whose team they are outside of (same rule as open/close/reboot).
                    Permission(
                        authorizedActions = listOf("add-chat-member"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                        customLogic = "is-thread-admin && added-user-not-a-foreign-agent",
                    ),
                    // DELETE /chat/{id} — only the owner may dissolve a group.
                    Permission(
                        authorizedActions = listOf("dissolve-chat"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_thread")),
                        customLogic = "owned",
                    ),

                    // -- Chat: messages ------------------------------------------------

                    // GET|POST /chat/{id}/messages. Agents post through the same rows: the
                    // tool-door authenticates them by machine+screen token and then asks this
                    // matrix as the agent user, so "an agent may only speak in its own groups" is
                    // this rule, not a second one written somewhere else.
                    Permission(
                        authorizedActions = listOf("enumerate-messages", "post-message"),
                        authorizedResource = AuthorizedResource(types = listOf("chat_message")),
                        customLogic = "is-thread-member",
                    ),

                    // -- Teams ---------------------------------------------------------

                    // GET /team — self-scoping. POST /team — anyone may found a team.
                    Permission(
                        authorizedActions = listOf("enumerate-my-teams", "create-team"),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                    ),
                    // GET /team/{id}, GET /team/{id}/members
                    Permission(
                        authorizedActions = listOf("query-team", "enumerate-team-members"),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                        customLogic = "is-team-member",
                    ),
                    // PATCH /team/{id}, the member routes, and the machine bindings. Binding a
                    // machine to a team is a change to the team, so it is the team's admins who
                    // may do it — plus, for an existing machine, someone who may already use it
                    // (the model is symmetric: any team it serves may pass it on).
                    Permission(
                        authorizedActions =
                            listOf(
                                "rename-team",
                                "add-team-member",
                                "remove-team-member",
                                "change-team-member-role",
                            ),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                        customLogic = "is-team-admin",
                    ),
                    Permission(
                        authorizedActions = listOf("bind-machine-to-team"),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                        customLogic = "is-team-member && can-access-bound-machine",
                    ),
                    Permission(
                        authorizedActions = listOf("unbind-machine-from-team"),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                        customLogic = "can-access-bound-machine",
                    ),
                    // DELETE /team/{id}
                    Permission(
                        authorizedActions = listOf("delete-team"),
                        authorizedResource = AuthorizedResource(types = listOf("team")),
                        customLogic = "owned",
                    ),

                    // -- Team documents (the team's git tree) --------------------------

                    // GET|PUT|PATCH|DELETE /team/{id}/document
                    Permission(
                        authorizedActions =
                            listOf(
                                "read-document",
                                "write-document",
                                "move-document",
                                "delete-document",
                            ),
                        authorizedResource = AuthorizedResource(types = listOf("team_document")),
                        customLogic = "is-team-member",
                    ),

                    // -- Machines ------------------------------------------------------

                    // POST /machine/enroll/approve — you may only enrol a machine into teams you
                    // belong to. (start/poll are @NoAuth: the machine has no identity yet.)
                    Permission(
                        authorizedActions = listOf("approve-enrollment"),
                        authorizedResource = AuthorizedResource(types = listOf("machine")),
                        customLogic = "is-member-of-every-enrolled-team",
                    ),
                    // GET /machine — either scoped to a team you are in, or unscoped, which by
                    // definition means "the machines of my own teams" and so needs no further
                    // right. Slicing machines a new way must add a filter and, if it widens what
                    // is reachable, a clause here.
                    Permission(
                        authorizedActions = listOf("enumerate-machines"),
                        authorizedResource = AuthorizedResource(types = listOf("machine")),
                        customLogic = "is-member-of-queried-team || is-enumerating-own-machines",
                    ),
                    // GET|PATCH|DELETE /machine/{id}. The model is owner-less and symmetric:
                    // every member of every team a machine serves has equal, full rights over it.
                    Permission(
                        authorizedActions =
                            listOf("query-machine", "rename-machine", "forget-machine"),
                        authorizedResource = AuthorizedResource(types = listOf("machine")),
                        customLogic = "can-access-machine",
                    ),

                    // -- 现场: watching a screen on a machine ---------------------------

                    // The whole rule, in one place: you may watch a screen if you may use the
                    // machine it runs on, or if it is an agent you share a group with. The second
                    // clause is false for a screen that is not an agent's (a shared shell), which
                    // is how an application widens access to its own screens without touching
                    // anyone else's.
                    Permission(
                        authorizedActions = listOf("watch"),
                        authorizedResource = AuthorizedResource(types = listOf("machine_screen")),
                        customLogic = "can-access-screen-machine || shares-group-with-screen-agent",
                    ),

                    // -- Agents --------------------------------------------------------

                    // GET /agent — open to any authenticated user because it backs every avatar,
                    // and it discloses nothing privileged: the live screen id is attached per
                    // agent only where the `watch` row above already allows it.
                    Permission(
                        authorizedActions = listOf("enumerate-agents"),
                        authorizedResource = AuthorizedResource(types = listOf("agent")),
                    ),
                    // POST /agent — you must belong to the team the agent will work for *and* be
                    // allowed to use the machine it will run on. Two separate facts, so neither
                    // can quietly satisfy the other.
                    Permission(
                        authorizedActions = listOf("open-agent"),
                        authorizedResource = AuthorizedResource(types = listOf("agent")),
                        customLogic = "is-member-of-target-team && can-access-target-machine",
                    ),
                    // DELETE /agent/{userId}
                    Permission(
                        authorizedActions = listOf("close-agent"),
                        authorizedResource = AuthorizedResource(types = listOf("agent")),
                        customLogic = "is-member-of-agent-team",
                    ),
                    // POST /agent/{userId}/reboot — same team-membership rule as close: a lifecycle
                    // action on an existing agent, so the caller must belong to its team.
                    Permission(
                        authorizedActions = listOf("reboot-agent"),
                        authorizedResource = AuthorizedResource(types = listOf("agent")),
                        customLogic = "is-member-of-agent-team",
                    ),
                ),
        )
    }
}
