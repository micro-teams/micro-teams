package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param name The machine's self-reported hostname */
data class StartEnrollmentRequestDTO(
    @Schema(example = "null", description = "The machine's self-reported hostname")
    @get:JsonProperty("name")
    val name: kotlin.String? = null
) {}
