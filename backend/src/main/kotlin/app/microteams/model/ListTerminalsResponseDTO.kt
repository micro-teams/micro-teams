package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/** @param terminals */
data class ListTerminalsResponseDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("terminals", required = true)
    @get:JsonProperty("terminals", required = true)
    val terminals: kotlin.collections.List<TerminalDTO>,
) {}
