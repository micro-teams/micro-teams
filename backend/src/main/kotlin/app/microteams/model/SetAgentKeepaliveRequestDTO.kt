package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param enabled Whether cache keepalive is on for this agent.
 * @param intervalSeconds Seconds between keepalive touches. Required (and must be positive) when
 *   enabling; the interval should sit comfortably under the Claude Code cache TTL (~1h) so the
 *   cache never lapses between touches. Ignored when disabling.
 */
data class SetAgentKeepaliveRequestDTO(
    @Schema(
        example = "null",
        required = true,
        description = "Whether cache keepalive is on for this agent.",
    )
    @get:JsonProperty("enabled", required = true)
    val enabled: kotlin.Boolean,
    @Schema(
        example = "null",
        description =
            "Seconds between keepalive touches. Required (and must be positive) when enabling; the interval should sit comfortably under the Claude Code cache TTL (~1h) so the cache never lapses between touches. Ignored when disabling. ",
    )
    @get:JsonProperty("intervalSeconds")
    val intervalSeconds: kotlin.Long? = null,
) {}
