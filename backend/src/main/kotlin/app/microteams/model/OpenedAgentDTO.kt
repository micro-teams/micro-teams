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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("agentUserId", required = true)
    val agentUserId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("sid", required = true)
    val sid: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("screenToken", required = true)
    val screenToken: kotlin.String,
) {}
