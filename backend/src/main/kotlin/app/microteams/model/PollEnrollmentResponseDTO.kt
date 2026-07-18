package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param status pending | approved
 * @param machineId
 * @param token The durable machine token, returned once on approval
 */
data class PollEnrollmentResponseDTO(
    @Schema(example = "null", required = true, description = "pending | approved")
    @get:JsonProperty("status", required = true)
    val status: kotlin.String,
    @Schema(example = "null", description = "")
    @get:JsonProperty("machineId")
    val machineId: kotlin.String? = null,
    @Schema(example = "null", description = "The durable machine token, returned once on approval")
    @get:JsonProperty("token")
    val token: kotlin.String? = null,
) {}
