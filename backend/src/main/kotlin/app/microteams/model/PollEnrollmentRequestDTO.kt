package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param code */
data class PollEnrollmentRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("code", required = true)
    val code: kotlin.String
) {}
