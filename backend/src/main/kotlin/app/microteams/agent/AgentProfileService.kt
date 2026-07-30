/*
 *  Description: Changing an agent's profile — today only its avatar, which a human cannot do
 *               directly.
 *
 *               The three profile tables belong to the identity service and are read-only here (see
 *               UserEntity), so the change must go through its API. But that API lets a user modify
 *               only their OWN profile: `PUT /users/{id}` is guarded by `modify-profile` scoped to
 *               the caller, so a human's token is refused for an agent's user, however much that
 *               human is entitled to manage the agent.
 *
 *               An agent, though, IS a user — and we can sign its token (AgentTokenService, the same
 *               one the tool-door hands a screen). So the change is performed AS THE AGENT, which
 *               the identity service accepts as ordinary self-modification and needs no change at
 *               all. Whether the human may ask for it is a separate question, already answered by
 *               the permission matrix before this is reached.
 *
 *               Note that identity's update is a whole-profile replace with nickname and intro
 *               required, so both are read back and resent unchanged. Sending only the avatar would
 *               wipe the agent's nickname — the caller asked to change a picture, not to erase who
 *               the agent is.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.user.UserProfileRepository
import jakarta.persistence.EntityManager
import org.rucca.cheese.common.config.ApplicationConfig
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.error.NotFoundError
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.client.RestClient

@Service
class AgentProfileService(
    private val agentTokenService: AgentTokenService,
    private val userProfileRepository: UserProfileRepository,
    private val entityManager: EntityManager,
    applicationConfig: ApplicationConfig,
) {
    private val logger = LoggerFactory.getLogger(AgentProfileService::class.java)
    private val identity = RestClient.create(applicationConfig.legacyUrl)

    /** Point [agentUserId]'s profile at [avatarId], as the agent itself. */
    @Transactional(readOnly = true)
    fun setAvatar(agentUserId: IdType, avatarId: Int) {
        val profile =
            userProfileRepository.findByUserId(agentUserId.toInt()).orElseThrow {
                NotFoundError("user", agentUserId)
            }
        // A one-purpose token, not the agent's ordinary one: see mintForOwnProfileUpdate.
        val token = agentTokenService.mintForOwnProfileUpdate(agentUserId).token
        val body =
            mapOf(
                // Resent as-is: identity replaces the whole profile, so omitting these clears them.
                "nickname" to (profile.nickname ?: "agent$agentUserId"),
                "intro" to (profile.intro ?: ""),
                "avatarId" to avatarId,
            )
        try {
            identity
                .put()
                .uri("/users/{id}", agentUserId)
                .header("Authorization", "Bearer $token")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .toBodilessEntity()
        } catch (e: Exception) {
            // The identity service is the authority here; a refusal from it (an avatar id that does
            // not exist, a nickname it now considers invalid) is the caller's problem to see, not a
            // 500. Its own message is the useful part.
            logger.warn(
                "setting avatar {} on agent {} failed: {}",
                avatarId,
                agentUserId,
                e.message,
            )
            throw BadRequestError("could not set the agent's avatar: ${e.message}")
        }
        // The profile row was changed by ANOTHER service, behind this session's back. Detach the
        // copy we loaded so the rest of the request re-reads it from the database: with one
        // EntityManager per request, a cached instance would otherwise report the old avatar
        // immediately after setting a new one. (Detach, not refresh — refresh needs a transaction,
        // and we only want the stale copy gone, not a write.)
        entityManager.detach(profile)
    }
}
