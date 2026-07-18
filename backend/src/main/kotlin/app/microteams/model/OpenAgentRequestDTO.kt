package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param machineId
 * @param teamId
 * @param nickname
 * @param cwd
 * @param driver Defaults to the server's default driver (claude)
 */
data class OpenAgentRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("teamId", required = true)
    val teamId: kotlin.Long,
    @Schema(example = "null", description = "")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("cwd")
    val cwd: kotlin.String? = null,
    @Schema(example = "null", description = "Defaults to the server's default driver (claude)")
    @get:JsonProperty("driver")
    val driver: kotlin.String? = null,
) {}
