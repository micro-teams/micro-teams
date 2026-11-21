package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * A user's membership in a thread
 *
 * @param id
 * @param threadId
 * @param userId
 * @param joinedAt
 * @param nickname The member's display name, carried here so a thread view can paint its members
 *   without a second lookup (ChatMember carries the same for the chat list).
 * @param avatarId The member's avatar; absent if they have none.
 */
data class ThreadMemberDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("threadId", required = true)
    @get:JsonProperty("threadId", required = true)
    val threadId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("userId", required = true)
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("joinedAt", required = true)
    @get:JsonProperty("joinedAt", required = true)
    val joinedAt: java.time.OffsetDateTime,
    @Schema(
        description =
            "The member's display name, carried here so a thread view can paint its members without a second lookup (ChatMember carries the same for the chat list). ",
    )
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(description = "The member's avatar; absent if they have none.")
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Long? = null,
) {}
