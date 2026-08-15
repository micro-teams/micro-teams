package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema

/**
 * An agent's cache-keepalive schedule, present in the agent view once configured.
 *
 * @param enabled
 * @param intervalSeconds Seconds between keepalive touches; present when a schedule has been set.
 */
data class AgentKeepaliveDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("enabled")
    @get:JsonProperty("enabled", required = true)
    val enabled: kotlin.Boolean,
    @Schema(
        description = "Seconds between keepalive touches; present when a schedule has been set."
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("intervalSeconds")
    @get:JsonProperty("intervalSeconds")
    val intervalSeconds: kotlin.Long? = null,
) {}
