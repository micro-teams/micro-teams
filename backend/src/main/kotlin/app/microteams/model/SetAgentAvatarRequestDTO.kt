package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param avatarId An avatar id from the identity service (POST /avatars). */
data class SetAgentAvatarRequestDTO(
    @Schema(
        required = true,
        description = "An avatar id from the identity service (POST /avatars).",
    )
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId", required = true)
    val avatarId: kotlin.Int
) {}
