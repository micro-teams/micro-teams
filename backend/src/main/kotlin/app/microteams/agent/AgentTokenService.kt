/*
 *  Description: Mints a short-lived JWT that IS an agent's own user token. An agent is an
 *               ordinary user, so instead of a bespoke tool-door authorization path, a screen's
 *               CLI exchanges its durable machine + screen tokens for one of these (see
 *               /agent/token) and then calls the same guarded endpoints a human does. The token is
 *               byte-compatible with the ones cheese-auth issues humans -- same HMAC256 secret,
 *               same `payload` claim shape (TokenPayload) -- so the frozen org.rucca.cheese.auth
 *               verifier accepts it with no change. Signing lives here, on our side of the fence,
 *               precisely so that kernel stays verify-only and independently extractable.
 *
 *               Short TTL by design: the CLI re-mints on demand, so a leaked token expires on its
 *               own rather than granting the agent user indefinitely.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import app.microteams.user.RolePermissionService
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.ObjectMapper
import org.rucca.cheese.auth.Authorization
import org.rucca.cheese.auth.AuthorizedResource
import org.rucca.cheese.auth.Permission
import org.rucca.cheese.auth.TokenPayload
import org.rucca.cheese.common.config.ApplicationConfig
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

/** A freshly signed agent token and the epoch-seconds instant it stops being valid. */
data class MintedToken(val token: String, val expiresAt: Long)

@Service
class AgentTokenService(
    applicationConfig: ApplicationConfig,
    objectMapper: ObjectMapper,
    private val rolePermissionService: RolePermissionService,
) {
    private val jwtSecret = applicationConfig.jwtSecret
    // Drop nulls so the nested claim map carries only supported JSON values; the verifier reads
    // it straight back into TokenPayload, whose absent fields default to null anyway.
    private val claimMapper =
        objectMapper.copy().setSerializationInclusion(JsonInclude.Include.NON_NULL)

    fun mint(agentUserId: IdType): MintedToken {
        val now = System.currentTimeMillis()
        val validUntil = now + TTL_MS
        // The agent gets exactly the standard-user permission set -- the same matrix a human is
        // subject to -- carried in the token the way cheese-auth carries a human's.
        val authorization =
            rolePermissionService.getAuthorizationForUserWithRole(agentUserId, "standard-user")
        val payload = TokenPayload(authorization, signedAt = now, validUntil = validUntil)

        return sign(payload)
    }

    /**
     * A token that may do exactly one thing: change [agentUserId]'s own profile in the identity
     * service. Deliberately NOT the standard-user set (which mt trims to its own endpoints and so
     * does not carry identity's `modify-profile` at all) and deliberately not a widening of the
     * token the agent's CLI holds: this capability belongs to the server, exercised as the agent
     * for one call, so an agent gains no new power over itself or anything else.
     *
     * `ownedByUser` is the agent, which is what makes identity accept it — its rule allows
     * modify-profile only on the caller's own user — and equally what stops this token from
     * touching anybody else's profile.
     */
    fun mintForOwnProfileUpdate(agentUserId: IdType): MintedToken {
        val now = System.currentTimeMillis()
        val validUntil = now + TTL_MS
        val authorization =
            Authorization(
                userId = agentUserId,
                permissions =
                    listOf(
                        Permission(
                            authorizedActions = listOf("modify-profile"),
                            authorizedResource =
                                AuthorizedResource(
                                    ownedByUser = agentUserId,
                                    types = listOf("user"),
                                ),
                        )
                    ),
            )
        return sign(TokenPayload(authorization, signedAt = now, validUntil = validUntil))
    }

    private fun sign(payload: TokenPayload): MintedToken {
        @Suppress("UNCHECKED_CAST")
        val claim = claimMapper.convertValue(payload, Map::class.java) as Map<String, Any>
        val token = JWT.create().withClaim("payload", claim).sign(Algorithm.HMAC256(jwtSecret))
        return MintedToken(token = token, expiresAt = payload.validUntil / 1000)
    }

    private companion object {
        const val TTL_MS = 5 * 60 * 1000L
    }
}
