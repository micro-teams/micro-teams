package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param code */
data class PollEnrollmentRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("code")
    @get:JsonProperty("code", required = true)
    val code: kotlin.String
) {}
