package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param title
 * @param memberIds
 */
data class CreateThreadRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("title")
    @get:JsonProperty("title", required = true)
    val title: kotlin.String,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("memberIds")
    @get:JsonProperty("memberIds")
    val memberIds: kotlin.collections.List<kotlin.Long>? = null,
) {}
