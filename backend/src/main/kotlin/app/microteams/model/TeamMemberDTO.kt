package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.JsonValue
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param userId
 * @param role
 * @param nickname
 */
data class TeamMemberDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("role")
    @get:JsonProperty("role", required = true)
    val role: TeamMemberDTO.Role,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("nickname")
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
                return values().firstOrNull { it -> it.value == value }
                    ?: throw IllegalArgumentException("Unexpected value '$value' for enum 'Role'")
            }
        }
    }
}
