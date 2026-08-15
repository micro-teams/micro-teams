package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/** @param lines */
data class LineRegistryDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("lines")
    @get:JsonProperty("lines", required = true)
    val lines: kotlin.collections.List<LineDTO>
) {}
