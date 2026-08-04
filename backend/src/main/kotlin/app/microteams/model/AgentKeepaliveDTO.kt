package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * An agent's cache-keepalive schedule, present in the agent view once configured.
 *
 * @param enabled
 * @param intervalSeconds Seconds between keepalive touches; present when a schedule has been set.
 */
data class AgentKeepaliveDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("enabled", required = true)
    val enabled: kotlin.Boolean,
    @Schema(
        example = "null",
        description = "Seconds between keepalive touches; present when a schedule has been set.",
    )
    @get:JsonProperty("intervalSeconds")
    val intervalSeconds: kotlin.Long? = null,
) {}
