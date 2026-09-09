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
    @Schema(required = true, description = "")
    @param:JsonProperty("enabled", required = true)
    @get:JsonProperty("enabled", required = true)
    val enabled: kotlin.Boolean,
    @Schema(
        description = "Seconds between keepalive touches; present when a schedule has been set."
    )
    @param:JsonProperty("intervalSeconds")
    @get:JsonProperty("intervalSeconds")
    val intervalSeconds: kotlin.Long? = null,
) {}
