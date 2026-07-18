package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param title */
data class RenameThreadRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("title", required = true)
    val title: kotlin.String
) {}
