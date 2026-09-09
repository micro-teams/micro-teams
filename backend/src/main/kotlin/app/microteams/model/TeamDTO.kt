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
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("name", required = true)
    @get:JsonProperty("name", required = true)
    val name: kotlin.String,
    @Schema(description = "")
    @param:JsonProperty("createdAt")
    @get:JsonProperty("createdAt")
    val createdAt: java.time.OffsetDateTime? = null,
    @Schema(description = "")
    @param:JsonProperty("updatedAt")
    @get:JsonProperty("updatedAt")
    val updatedAt: java.time.OffsetDateTime? = null,
) {}
