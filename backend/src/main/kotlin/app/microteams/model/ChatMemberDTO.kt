package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param userId
 * @param nickname
 * @param avatarId
 */
data class ChatMemberDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(example = "null", description = "")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Int? = null,
) {}
