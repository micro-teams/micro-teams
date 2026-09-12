package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * Chat thread (group or direct)
 *
 * @param id
 * @param createdAt
 * @param title
 * @param updatedAt
 */
data class ThreadDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("createdAt", required = true)
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(description = "")
    @param:JsonProperty("title")
    @get:JsonProperty("title")
    val title: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("updatedAt")
    @get:JsonProperty("updatedAt")
    val updatedAt: java.time.OffsetDateTime? = null,
) {}
