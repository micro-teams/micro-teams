package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param command Run this command (through sh -c) instead of opening a login shell.
 * @param cwd
 */
data class OpenTerminalRequestDTO(
    @Schema(description = "Run this command (through sh -c) instead of opening a login shell.")
    @param:JsonProperty("command")
    @get:JsonProperty("command")
    val command: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("cwd")
    @get:JsonProperty("cwd")
    val cwd: kotlin.String? = null,
) {}
