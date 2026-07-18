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

        @Suppress("UNCHECKED_CAST")
        val claim = claimMapper.convertValue(payload, Map::class.java) as Map<String, Any>
        val token = JWT.create().withClaim("payload", claim).sign(Algorithm.HMAC256(jwtSecret))
        return MintedToken(token = token, expiresAt = validUntil / 1000)
    }

    private companion object {
        const val TTL_MS = 5 * 60 * 1000L
    }
}
