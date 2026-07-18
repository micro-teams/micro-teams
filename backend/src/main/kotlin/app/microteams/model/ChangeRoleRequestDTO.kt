package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/** @param role */
data class ChangeRoleRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("role", required = true)
    val role: ChangeRoleRequestDTO.Role
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
