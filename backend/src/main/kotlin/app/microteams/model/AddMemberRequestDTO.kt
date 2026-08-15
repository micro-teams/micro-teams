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
 */
data class AddMemberRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("role")
    @get:JsonProperty("role")
    val role: AddMemberRequestDTO.Role? = null,
) {

    /** Values: MEMBER,ADMIN,OWNER */
    enum class Role(@get:JsonValue val value: kotlin.String) {

        MEMBER("MEMBER"),
        ADMIN("ADMIN"),
        OWNER("OWNER");

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
