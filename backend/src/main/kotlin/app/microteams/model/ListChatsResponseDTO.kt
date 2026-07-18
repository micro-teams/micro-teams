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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("chats", required = true)
    val chats: kotlin.collections.List<ChatSummaryDTO>,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
