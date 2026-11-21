package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param team
 * @param members
 * @param parents The teams this team is inside (their members can access it).
 * @param subteams The teams inside this one.
 * @param isMember Whether the caller is a member, rather than reaching it through a parent.
 */
data class TeamDetailDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("team", required = true)
    @get:JsonProperty("team", required = true)
    val team: TeamDTO,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("members", required = true)
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<TeamMemberDTO>,
    @field:Valid
    @Schema(
        required = true,
        description = "The teams this team is inside (their members can access it).",
    )
    @param:JsonProperty("parents", required = true)
    @get:JsonProperty("parents", required = true)
    val parents: kotlin.collections.List<TeamDTO>,
    @field:Valid
    @Schema(required = true, description = "The teams inside this one.")
    @param:JsonProperty("subteams", required = true)
    @get:JsonProperty("subteams", required = true)
    val subteams: kotlin.collections.List<TeamDTO>,
    @Schema(
        required = true,
        description = "Whether the caller is a member, rather than reaching it through a parent.",
    )
    @param:JsonProperty("isMember", required = true)
    @get:JsonProperty("isMember", required = true)
    val isMember: kotlin.Boolean,
) {}
