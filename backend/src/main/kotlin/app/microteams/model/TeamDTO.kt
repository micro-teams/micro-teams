package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param id
 * @param name
 * @param createdAt
 * @param updatedAt
 */
data class TeamDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("name", required = true)
    val name: kotlin.String,
    @Schema(example = "null", description = "")
    @get:JsonProperty("createdAt")
    val createdAt: java.time.OffsetDateTime? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("updatedAt")
    val updatedAt: java.time.OffsetDateTime? = null,
) {}
