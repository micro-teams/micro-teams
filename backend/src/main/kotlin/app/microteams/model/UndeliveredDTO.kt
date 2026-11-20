package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * One recipient a message did not reach, and why.
 *
 * @param userId
 * @param reason
 */
data class UndeliveredDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId", required = true)
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("reason", required = true)
    @get:JsonProperty("reason", required = true)
    val reason: kotlin.String,
) {}
