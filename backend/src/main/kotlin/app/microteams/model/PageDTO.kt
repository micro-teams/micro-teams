package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
    @Schema(required = true, description = "id of the first item on this page")
    @param:JsonProperty("page_start")
    @get:JsonProperty("page_start", required = true)
    val pageStart: kotlin.Long,
    @Schema(required = true, description = "items per page")
    @param:JsonProperty("page_size")
    @get:JsonProperty("page_size", required = true)
    val pageSize: kotlin.Int,
    @Schema(required = true, description = "whether a previous page exists")
    @param:JsonProperty("has_prev")
    @get:JsonProperty("has_prev", required = true)
    val hasPrev: kotlin.Boolean,
    @Schema(required = true, description = "whether a next page exists")
    @param:JsonProperty("has_more")
    @get:JsonProperty("has_more", required = true)
    val hasMore: kotlin.Boolean,
    @Schema(description = "id of the first item on the previous page")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("prev_start")
    @get:JsonProperty("prev_start")
    val prevStart: kotlin.Long? = null,
    @Schema(description = "id of the first item on the next page")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("next_start")
    @get:JsonProperty("next_start")
    val nextStart: kotlin.Long? = null,
) {}
