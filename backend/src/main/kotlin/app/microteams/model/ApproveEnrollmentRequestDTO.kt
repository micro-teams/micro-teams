package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param code
 * @param teamIds
 */
data class ApproveEnrollmentRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("code")
    @get:JsonProperty("code", required = true)
    val code: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("teamIds")
    @get:JsonProperty("teamIds", required = true)
    val teamIds: kotlin.collections.List<kotlin.Long>,
) {}
