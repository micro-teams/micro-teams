package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/**
 * A user's membership in a thread
 *
 * @param id
 * @param threadId
 * @param userId
 * @param role 0=MEMBER, 1=ADMIN, 2=OWNER
 * @param joinedAt
 * @param nickname The member's display name, carried here so a thread view can paint its members
 *   without a second lookup (ChatMember carries the same for the chat list).
 * @param avatarId The member's avatar; absent if they have none.
 */
data class ThreadMemberDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("threadId", required = true)
    val threadId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(example = "null", required = true, description = "0=MEMBER, 1=ADMIN, 2=OWNER")
    @get:JsonProperty("role", required = true)
    val role: ThreadMemberDTO.Role,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("joinedAt", required = true)
    val joinedAt: java.time.OffsetDateTime,
    @Schema(
        example = "null",
        description =
            "The member's display name, carried here so a thread view can paint its members without a second lookup (ChatMember carries the same for the chat list). ",
    )
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(example = "null", description = "The member's avatar; absent if they have none.")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Long? = null,
) {

    /** 0=MEMBER, 1=ADMIN, 2=OWNER Values: MEMBER,ADMIN,OWNER */
    enum class Role(@get:JsonValue val value: kotlin.String) {

        MEMBER("MEMBER"),
        ADMIN("ADMIN"),
        OWNER("OWNER");

        companion object {
            @JvmStatic
            @JsonCreator
            fun forValue(value: kotlin.String): Role {
                return values().first { it -> it.value == value }
            }
        }
    }
}
