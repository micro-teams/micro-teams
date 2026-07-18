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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("teams", required = true)
    val teams: kotlin.collections.List<TeamDTO>,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
