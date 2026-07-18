package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param content */
data class PostMessageRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String
) {}
