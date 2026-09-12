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
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("title", required = true)
    @get:JsonProperty("title", required = true)
    val title: kotlin.String,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("members", required = true)
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<ChatMemberDTO>,
    @Schema(
        required = true,
        description = "Last activity (last message time, else the chat's creation time)",
    )
    @param:JsonProperty("updatedAt", required = true)
    @get:JsonProperty("updatedAt", required = true)
    val updatedAt: java.time.OffsetDateTime,
    @field:Valid
    @Schema(description = "")
    @param:JsonProperty("lastMessage")
    @get:JsonProperty("lastMessage")
    val lastMessage: ChatLastMessageDTO? = null,
) {}
