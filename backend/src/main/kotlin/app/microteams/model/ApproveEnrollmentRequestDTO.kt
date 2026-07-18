package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param code
 * @param teamIds
 */
data class ApproveEnrollmentRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("code", required = true)
    val code: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("teamIds", required = true)
    val teamIds: kotlin.collections.List<kotlin.Long>,
) {}
