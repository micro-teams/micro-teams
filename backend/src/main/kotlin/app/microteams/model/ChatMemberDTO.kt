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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(example = "null", description = "")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Int? = null,
    @Schema(
        example = "null",
        description =
            "Whether this member is an agent. Answered only when the request asked for it (queryIsMemberAgent=true); null means the question was not asked, which is NOT the same as false. ",
    )
    @get:JsonProperty("isAgent")
    val isAgent: kotlin.Boolean? = null,
) {}
