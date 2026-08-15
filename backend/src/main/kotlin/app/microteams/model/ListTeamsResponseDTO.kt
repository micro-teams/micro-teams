package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param teams
 * @param page
 */
data class ListTeamsResponseDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("teams")
    @get:JsonProperty("teams", required = true)
    val teams: kotlin.collections.List<TeamDTO>,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("page")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
