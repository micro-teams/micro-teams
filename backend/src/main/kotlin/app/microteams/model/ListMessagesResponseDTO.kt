package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param messages
 * @param page
 */
data class ListMessagesResponseDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("messages")
    @get:JsonProperty("messages", required = true)
    val messages: kotlin.collections.List<MessageDTO>,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("page")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
