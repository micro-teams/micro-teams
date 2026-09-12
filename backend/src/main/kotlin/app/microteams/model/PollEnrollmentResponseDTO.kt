package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param status pending | approved
 * @param machineId
 * @param token The durable machine token, returned once on approval
 */
data class PollEnrollmentResponseDTO(
    @Schema(required = true, description = "pending | approved")
    @param:JsonProperty("status", required = true)
    @get:JsonProperty("status", required = true)
    val status: kotlin.String,
    @Schema(description = "")
    @param:JsonProperty("machineId")
    @get:JsonProperty("machineId")
    val machineId: kotlin.String? = null,
    @Schema(description = "The durable machine token, returned once on approval")
    @param:JsonProperty("token")
    @get:JsonProperty("token")
    val token: kotlin.String? = null,
) {}
