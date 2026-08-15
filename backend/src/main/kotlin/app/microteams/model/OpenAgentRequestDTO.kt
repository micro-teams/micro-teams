package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
    @param:JsonProperty("machineId")
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("teamId")
    @get:JsonProperty("teamId", required = true)
    val teamId: kotlin.Long,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("cwd")
    @get:JsonProperty("cwd")
    val cwd: kotlin.String? = null,
    @Schema(description = "Defaults to the server's default driver (claude)")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("driver")
    @get:JsonProperty("driver")
    val driver: kotlin.String? = null,
    @Schema(
        description =
            "Opaque driver session id to open the agent with. When omitted the server mints one. Supplying it (together with a matching cwd and resume=true) resumes a prior session. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("sessionId")
    @get:JsonProperty("sessionId")
    val sessionId: kotlin.String? = null,
    @Schema(
        description =
            "Resume the given sessionId's prior transcript instead of starting it fresh. Only meaningful together with sessionId; the driver decides what resuming means. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("resume")
    @get:JsonProperty("resume")
    val resume: kotlin.Boolean? = false,
) {}
