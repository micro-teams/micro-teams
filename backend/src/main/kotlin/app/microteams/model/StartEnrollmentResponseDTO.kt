package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param code
 * @param approveUrl
 */
data class StartEnrollmentResponseDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("code", required = true)
    val code: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("approveUrl", required = true)
    val approveUrl: kotlin.String,
) {}
