package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param sha
 * @param message
 * @param author
 * @param timestamp
 */
data class DocCommitDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("sha")
    @get:JsonProperty("sha", required = true)
    val sha: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("message")
    @get:JsonProperty("message", required = true)
    val message: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("author")
    @get:JsonProperty("author", required = true)
    val author: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("timestamp")
    @get:JsonProperty("timestamp", required = true)
    val timestamp: kotlin.Long,
) {}
