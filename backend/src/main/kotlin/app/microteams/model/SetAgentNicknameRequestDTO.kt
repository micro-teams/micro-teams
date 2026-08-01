package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param nickname The agent's new display name. */
data class SetAgentNicknameRequestDTO(
    @Schema(example = "null", required = true, description = "The agent's new display name.")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String
) {}
