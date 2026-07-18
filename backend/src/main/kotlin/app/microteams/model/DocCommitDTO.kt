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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("sha", required = true)
    val sha: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("message", required = true)
    val message: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("author", required = true)
    val author: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("timestamp", required = true)
    val timestamp: kotlin.Long,
) {}
