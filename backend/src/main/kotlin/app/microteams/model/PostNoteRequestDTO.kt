package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param text
 * @param threadId Defaults to the thread the agent was last spoken to in
 */
data class PostNoteRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("text", required = true)
    val text: kotlin.String,
    @Schema(
        example = "null",
        description = "Defaults to the thread the agent was last spoken to in",
    )
    @get:JsonProperty("thread_id")
    val threadId: kotlin.Long? = null,
) {}
