package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param title
 * @param memberIds
 */
data class CreateThreadRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("title", required = true)
    val title: kotlin.String,
    @Schema(example = "null", description = "")
    @get:JsonProperty("memberIds")
    val memberIds: kotlin.collections.List<kotlin.Long>? = null,
) {}
