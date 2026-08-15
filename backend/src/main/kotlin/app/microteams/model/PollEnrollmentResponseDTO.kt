package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param status pending | approved
 * @param machineId
 * @param token The durable machine token, returned once on approval
 */
data class PollEnrollmentResponseDTO(
    @Schema(required = true, description = "pending | approved")
    @param:JsonProperty("status")
    @get:JsonProperty("status", required = true)
    val status: kotlin.String,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("machineId")
    @get:JsonProperty("machineId")
    val machineId: kotlin.String? = null,
    @Schema(description = "The durable machine token, returned once on approval")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("token")
    @get:JsonProperty("token")
    val token: kotlin.String? = null,
) {}
