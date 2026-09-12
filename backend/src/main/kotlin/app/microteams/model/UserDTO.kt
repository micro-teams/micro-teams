package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.constraints.Min

/**
 * @param avatarId avatar id
 * @param id user id
 * @param intro short bio
 * @param nickname nickname
 * @param username username
 */
data class UserDTO(
    @Schema(required = true, description = "avatar id")
    @param:JsonProperty("avatarId", required = true)
    @get:JsonProperty("avatarId", required = true)
    val avatarId: kotlin.Long,
    @get:Min(value = 1L)
    @Schema(required = true, description = "user id")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "short bio")
    @param:JsonProperty("intro", required = true)
    @get:JsonProperty("intro", required = true)
    val intro: kotlin.String = "This user has not set an introduction yet.",
    @Schema(required = true, description = "nickname")
    @param:JsonProperty("nickname", required = true)
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(required = true, description = "username")
    @param:JsonProperty("username", required = true)
    @get:JsonProperty("username", required = true)
    val username: kotlin.String,
) {}
