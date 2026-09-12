package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param machineId
 * @param teamId
 * @param nickname
 * @param cwd
 * @param driver Defaults to the server's default driver (claude)
 * @param sessionId Opaque driver session id to open the agent with. When omitted the server mints
 *   one. Supplying it (together with a matching cwd and resume=true) resumes a prior session.
 * @param resume Resume the given sessionId's prior transcript instead of starting it fresh. Only
 *   meaningful together with sessionId; the driver decides what resuming means.
 */
data class OpenAgentRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("machineId", required = true)
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("teamId", required = true)
    @get:JsonProperty("teamId", required = true)
    val teamId: kotlin.Long,
    @Schema(description = "")
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("cwd")
    @get:JsonProperty("cwd")
    val cwd: kotlin.String? = null,
    @Schema(description = "Defaults to the server's default driver (claude)")
    @param:JsonProperty("driver")
    @get:JsonProperty("driver")
    val driver: kotlin.String? = null,
    @Schema(
        description =
            "Opaque driver session id to open the agent with. When omitted the server mints one. Supplying it (together with a matching cwd and resume=true) resumes a prior session. "
    )
    @param:JsonProperty("sessionId")
    @get:JsonProperty("sessionId")
    val sessionId: kotlin.String? = null,
    @Schema(
        description =
            "Resume the given sessionId's prior transcript instead of starting it fresh. Only meaningful together with sessionId; the driver decides what resuming means. "
    )
    @param:JsonProperty("resume")
    @get:JsonProperty("resume")
    val resume: kotlin.Boolean? = false,
) {}
