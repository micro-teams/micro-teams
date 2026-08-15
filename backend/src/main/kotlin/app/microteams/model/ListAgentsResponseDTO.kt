package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param agents
 * @param page
 */
data class ListAgentsResponseDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("agents")
    @get:JsonProperty("agents", required = true)
    val agents: kotlin.collections.List<AgentDTO>,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("page")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
