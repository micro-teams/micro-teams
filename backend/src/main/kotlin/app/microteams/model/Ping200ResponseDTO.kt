package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param code
 * @param message
 */
data class Ping200ResponseDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("code", required = true)
    val code: kotlin.Int,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("message", required = true)
    val message: kotlin.String,
) {}
