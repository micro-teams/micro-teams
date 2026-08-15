package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param title */
data class RenameThreadRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("title")
    @get:JsonProperty("title", required = true)
    val title: kotlin.String
) {}
