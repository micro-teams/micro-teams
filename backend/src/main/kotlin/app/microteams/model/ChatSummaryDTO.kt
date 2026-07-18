package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param id
 * @param title
 * @param members
 * @param updatedAt Last activity (last message time, else the chat's creation time)
 * @param lastMessage
 */
data class ChatSummaryDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("title", required = true)
    val title: kotlin.String,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<ChatMemberDTO>,
    @Schema(
        example = "null",
        required = true,
        description = "Last activity (last message time, else the chat's creation time)",
    )
    @get:JsonProperty("updatedAt", required = true)
    val updatedAt: java.time.OffsetDateTime,
    @field:Valid
    @Schema(example = "null", description = "")
    @get:JsonProperty("lastMessage")
    val lastMessage: ChatLastMessageDTO? = null,
) {}
