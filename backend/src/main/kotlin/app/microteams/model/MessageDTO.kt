package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * A chat message in a thread
 *
 * @param id
 * @param kind TEXT is something said; JOINED and LEFT record that the sender joined or left the
 *   thread (content is empty).
 * @param threadId
 * @param senderId
 * @param content
 * @param createdAt
 * @param editedAt
 * @param clientToken Echoed back when the caller supplied one, so a client can recognise its own
 *   pending message in the one returned (and in a later poll) rather than guessing by content.
 * @param undelivered The recipients this message definitely did not reach (an agent whose program
 *   could not take it), each with the reason. Absent or empty when nothing is known to have failed.
 */
data class MessageDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.Long,
    @Schema(
        required = true,
        description =
            "TEXT is something said; JOINED and LEFT record that the sender joined or left the thread (content is empty). ",
    )
    @param:JsonProperty("kind", required = true)
    @get:JsonProperty("kind", required = true)
    val kind: MessageDTO.Kind,
    @Schema(required = true, description = "")
    @param:JsonProperty("threadId", required = true)
    @get:JsonProperty("threadId", required = true)
    val threadId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("senderId", required = true)
    @get:JsonProperty("senderId", required = true)
    val senderId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("content", required = true)
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("createdAt", required = true)
    @get:JsonProperty("createdAt", required = true)
    val createdAt: java.time.OffsetDateTime,
    @Schema(description = "")
    @param:JsonProperty("editedAt")
    @get:JsonProperty("editedAt")
    val editedAt: java.time.OffsetDateTime? = null,
    @Schema(
        description =
            "Echoed back when the caller supplied one, so a client can recognise its own pending message in the one returned (and in a later poll) rather than guessing by content. ",
    )
    @param:JsonProperty("clientToken")
    @get:JsonProperty("clientToken")
    val clientToken: kotlin.String? = null,
    @field:Valid
    @Schema(
        description =
            "The recipients this message definitely did not reach (an agent whose program could not take it), each with the reason. Absent or empty when nothing is known to have failed. ",
    )
    @param:JsonProperty("undelivered")
    @get:JsonProperty("undelivered")
    val undelivered: kotlin.collections.List<UndeliveredDTO>? = null,
) {

    /**
     * TEXT is something said; JOINED and LEFT record that the sender joined or left the thread
     * (content is empty). Values: TEXT,JOINED,LEFT
     */
    enum class Kind(@get:JsonValue val value: kotlin.String) {

        TEXT("TEXT"),
        JOINED("JOINED"),
        LEFT("LEFT");

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
