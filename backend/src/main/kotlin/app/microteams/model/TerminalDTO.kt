package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/**
 * A terminal or a command on a machine. Watch it through the live screen with its sid.
 *
 * @param sid
 * @param machineId
 * @param kind
 * @param openedBy
 * @param createdAt
 * @param command The command a COMMAND runs.
 * @param exitCode A finished command's exit code.
 */
data class TerminalDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("sid", required = true)
    @get:JsonProperty("sid", required = true)
    val sid: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("machineId", required = true)
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("kind", required = true)
    @get:JsonProperty("kind", required = true)
    val kind: TerminalDTO.Kind,
    @Schema(required = true, description = "")
    @param:JsonProperty("openedBy", required = true)
    @get:JsonProperty("openedBy", required = true)
    val openedBy: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("createdAt", required = true)
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(description = "The command a COMMAND runs.")
    @param:JsonProperty("command")
    @get:JsonProperty("command")
    val command: kotlin.String? = null,
    @Schema(description = "A finished command's exit code.")
    @param:JsonProperty("exitCode")
    @get:JsonProperty("exitCode")
    val exitCode: kotlin.Int? = null,
) {

    /** Values: TERMINAL,COMMAND */
    enum class Kind(@get:JsonValue val value: kotlin.String) {

        TERMINAL("TERMINAL"),
        COMMAND("COMMAND");

        companion object {
            @JvmStatic
            @JsonCreator
            fun forValue(value: kotlin.String): Kind {
                return values().firstOrNull { it.value == value }
                    ?: throw IllegalArgumentException("Unexpected value '$value' for enum 'Kind'")
            }
        }
    }
}
