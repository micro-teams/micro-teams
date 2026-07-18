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
    @Schema(example = "null", required = true, description = "avatar id")
    @get:JsonProperty("avatarId", required = true)
    val avatarId: kotlin.Long,
    @get:Min(1L)
    @Schema(example = "null", required = true, description = "user id")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "short bio")
    @get:JsonProperty("intro", required = true)
    val intro: kotlin.String = "This user has not set an introduction yet.",
    @Schema(example = "null", required = true, description = "nickname")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(example = "null", required = true, description = "username")
    @get:JsonProperty("username", required = true)
    val username: kotlin.String,
) {}
