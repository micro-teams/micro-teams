package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param content
 * @param senderId
 * @param createdAt
 */
data class ChatLastMessageDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("senderId", required = true)
    val senderId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
) {}
