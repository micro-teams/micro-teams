package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param team
 * @param members
 */
data class TeamDetailDTO(
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("team", required = true)
    val team: TeamDTO,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<TeamMemberDTO>,
) {}
