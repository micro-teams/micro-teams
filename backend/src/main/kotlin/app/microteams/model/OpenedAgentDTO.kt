package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param agentUserId
 * @param sid
 * @param machineId
 * @param screenToken
 */
data class OpenedAgentDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("agentUserId")
    @get:JsonProperty("agentUserId", required = true)
    val agentUserId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("sid")
    @get:JsonProperty("sid", required = true)
    val sid: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("machineId")
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("screenToken")
    @get:JsonProperty("screenToken", required = true)
    val screenToken: kotlin.String,
) {}
