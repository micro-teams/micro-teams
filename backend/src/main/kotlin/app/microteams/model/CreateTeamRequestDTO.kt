package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param name
 * @param parentId
 */
data class CreateTeamRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("name", required = true)
    @get:JsonProperty("name", required = true)
    val name: kotlin.String,
    @Schema(description = "")
    @param:JsonProperty("parentId")
    @get:JsonProperty("parentId")
    val parentId: kotlin.Long? = null,
) {}
