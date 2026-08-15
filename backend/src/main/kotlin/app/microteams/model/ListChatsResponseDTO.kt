package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param chats
 * @param page
 */
data class ListChatsResponseDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("chats")
    @get:JsonProperty("chats", required = true)
    val chats: kotlin.collections.List<ChatSummaryDTO>,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("page")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
