package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param enabled Whether cache keepalive is on for this agent.
 * @param intervalSeconds Seconds between keepalive touches. Required (and must be positive) when
 *   enabling; the interval should sit comfortably under the Claude Code cache TTL (~1h) so the
 *   cache never lapses between touches. Ignored when disabling.
 */
data class SetAgentKeepaliveRequestDTO(
    @Schema(required = true, description = "Whether cache keepalive is on for this agent.")
    @param:JsonProperty("enabled")
    @get:JsonProperty("enabled", required = true)
    val enabled: kotlin.Boolean,
    @Schema(
        description =
            "Seconds between keepalive touches. Required (and must be positive) when enabling; the interval should sit comfortably under the Claude Code cache TTL (~1h) so the cache never lapses between touches. Ignored when disabling. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("intervalSeconds")
    @get:JsonProperty("intervalSeconds")
    val intervalSeconds: kotlin.Long? = null,
) {}
