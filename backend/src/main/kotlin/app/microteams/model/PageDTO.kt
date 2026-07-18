package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * pagination info
 *
 * @param pageStart id of the first item on this page
 * @param pageSize items per page
 * @param hasPrev whether a previous page exists
 * @param hasMore whether a next page exists
 * @param prevStart id of the first item on the previous page
 * @param nextStart id of the first item on the next page
 */
data class PageDTO(
    @Schema(example = "null", required = true, description = "id of the first item on this page")
    @get:JsonProperty("page_start", required = true)
    val pageStart: kotlin.Long,
    @Schema(example = "null", required = true, description = "items per page")
    @get:JsonProperty("page_size", required = true)
    val pageSize: kotlin.Int,
    @Schema(example = "null", required = true, description = "whether a previous page exists")
    @get:JsonProperty("has_prev", required = true)
    val hasPrev: kotlin.Boolean,
    @Schema(example = "null", required = true, description = "whether a next page exists")
    @get:JsonProperty("has_more", required = true)
    val hasMore: kotlin.Boolean,
    @Schema(example = "null", description = "id of the first item on the previous page")
    @get:JsonProperty("prev_start")
    val prevStart: kotlin.Long? = null,
    @Schema(example = "null", description = "id of the first item on the next page")
    @get:JsonProperty("next_start")
    val nextStart: kotlin.Long? = null,
) {}
