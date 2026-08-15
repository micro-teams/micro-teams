package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param content
 * @param senderId
 * @param createdAt
 */
data class ChatLastMessageDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("content")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("senderId")
    @get:JsonProperty("senderId", required = true)
    val senderId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("createdAt")
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
) {}
