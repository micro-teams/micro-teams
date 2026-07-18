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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(example = "null", description = "")
    @get:JsonProperty("title")
    val title: kotlin.String? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("updatedAt")
    val updatedAt: java.time.OffsetDateTime? = null,
) {}
