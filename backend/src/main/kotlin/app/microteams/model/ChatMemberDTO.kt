package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
    @param:JsonProperty("userId")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Int? = null,
    @Schema(
        description =
            "Whether this member is an agent. Answered only when the request asked for it (queryIsMemberAgent=true); null means the question was not asked, which is NOT the same as false. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("isAgent")
    @get:JsonProperty("isAgent")
    val isAgent: kotlin.Boolean? = null,
) {}
