package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * A chat message in a thread
 *
 * @param id
 * @param threadId
 * @param senderId
 * @param content
 * @param createdAt
 * @param editedAt
 * @param clientToken Echoed back when the caller supplied one, so a client can recognise its own
 *   pending message in the one returned (and in a later poll) rather than guessing by content.
 */
data class MessageDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("threadId", required = true)
    val threadId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("senderId", required = true)
    val senderId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(example = "null", description = "")
    @get:JsonProperty("editedAt")
    val editedAt: java.time.OffsetDateTime? = null,
    @Schema(
        example = "null",
        description =
            "Echoed back when the caller supplied one, so a client can recognise its own pending message in the one returned (and in a later poll) rather than guessing by content. ",
    )
    @get:JsonProperty("clientToken")
    val clientToken: kotlin.String? = null,
) {}
