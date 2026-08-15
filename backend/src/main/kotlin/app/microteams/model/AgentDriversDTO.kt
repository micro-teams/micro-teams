package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param drivers
 * @param defaultDriver
 */
data class AgentDriversDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("drivers")
    @get:JsonProperty("drivers", required = true)
    val drivers: kotlin.collections.List<kotlin.String>,
    @Schema(required = true, description = "")
    @param:JsonProperty("defaultDriver")
    @get:JsonProperty("defaultDriver", required = true)
    val defaultDriver: kotlin.String,
) {}
