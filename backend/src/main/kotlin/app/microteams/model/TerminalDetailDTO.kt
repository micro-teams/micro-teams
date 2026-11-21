package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param terminal
 * @param finished Whether a command has finished (always false for a terminal).
 * @param output The screen's text; absent while the machine is offline.
 */
data class TerminalDetailDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("terminal", required = true)
    @get:JsonProperty("terminal", required = true)
    val terminal: TerminalDTO,
    @Schema(
        required = true,
        description = "Whether a command has finished (always false for a terminal).",
    )
    @param:JsonProperty("finished", required = true)
    @get:JsonProperty("finished", required = true)
    val finished: kotlin.Boolean,
    @Schema(description = "The screen's text; absent while the machine is offline.")
    @param:JsonProperty("output")
    @get:JsonProperty("output")
    val output: kotlin.String? = null,
) {}
