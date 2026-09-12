package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param userId
 * @param nickname
 * @param avatarId
 * @param isAgent Whether this member is an agent. Answered only when the request asked for it
 *   (queryIsMemberAgent=true); null means the question was not asked, which is NOT the same as
 *   false.
 */
data class ChatMemberDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId", required = true)
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("nickname", required = true)
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(description = "")
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Int? = null,
    @Schema(
        description =
            "Whether this member is an agent. Answered only when the request asked for it (queryIsMemberAgent=true); null means the question was not asked, which is NOT the same as false. "
    )
    @param:JsonProperty("isAgent")
    @get:JsonProperty("isAgent")
    val isAgent: kotlin.Boolean? = null,
) {}
