package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

/** approve status Values: APPROVED,DISAPPROVED,NONE */
enum class ApproveTypeDTO(@get:JsonValue val value: kotlin.String) {

    APPROVED("APPROVED"),
    DISAPPROVED("DISAPPROVED"),
    NONE("NONE");

    companion object {
        @JvmStatic
        @JsonCreator
        fun forValue(value: kotlin.String): ApproveTypeDTO {
            return values().first { it -> it.value == value }
        }
    }
}
