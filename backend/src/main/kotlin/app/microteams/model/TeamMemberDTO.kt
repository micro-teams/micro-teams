package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param userId
 * @param role
 * @param nickname
 */
data class TeamMemberDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("role", required = true)
    val role: TeamMemberDTO.Role,
    @Schema(example = "null", description = "")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
) {

    /** Values: OWNER,ADMIN,MEMBER */
    enum class Role(@get:JsonValue val value: kotlin.String) {

        OWNER("OWNER"),
        ADMIN("ADMIN"),
        MEMBER("MEMBER");

        companion object {
            @JvmStatic
            @JsonCreator
            fun forValue(value: kotlin.String): Role {
                return values().first { it -> it.value == value }
            }
        }
    }
}
