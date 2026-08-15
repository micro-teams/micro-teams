package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param token A JWT that is the agent's own user token, sent as an Authorization Bearer header.
 * @param expiresAt Unix epoch seconds after which the token is no longer valid.
 */
data class AgentTokenDTO(
    @Schema(
        required = true,
        description =
            "A JWT that is the agent's own user token, sent as an Authorization Bearer header.",
    )
    @param:JsonProperty("token")
    @get:JsonProperty("token", required = true)
    val token: kotlin.String,
    @Schema(
        required = true,
        description = "Unix epoch seconds after which the token is no longer valid.",
    )
    @param:JsonProperty("expiresAt")
    @get:JsonProperty("expiresAt", required = true)
    val expiresAt: kotlin.Long,
) {}
