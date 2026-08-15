package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
    @Schema(required = true, description = "")
    @param:JsonProperty("id")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("threadId")
    @get:JsonProperty("threadId", required = true)
    val threadId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("senderId")
    @get:JsonProperty("senderId", required = true)
    val senderId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("content")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("createdAt")
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("editedAt")
    @get:JsonProperty("editedAt")
    val editedAt: java.time.OffsetDateTime? = null,
    @Schema(
        description =
            "Echoed back when the caller supplied one, so a client can recognise its own pending message in the one returned (and in a later poll) rather than guessing by content. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("clientToken")
    @get:JsonProperty("clientToken")
    val clientToken: kotlin.String? = null,
) {}
