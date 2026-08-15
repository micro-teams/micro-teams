package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param newPath */
data class MoveDocumentRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("newPath")
    @get:JsonProperty("newPath", required = true)
    val newPath: kotlin.String
) {}
