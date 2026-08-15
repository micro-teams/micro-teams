package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param path
 * @param isFolder
 * @param commitSha
 * @param children
 * @param content
 * @param history
 * @param diff
 */
data class DocNodeDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("path")
    @get:JsonProperty("path", required = true)
    val path: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("isFolder")
    @get:JsonProperty("isFolder", required = true)
    val isFolder: kotlin.Boolean,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("commitSha")
    @get:JsonProperty("commitSha")
    val commitSha: kotlin.String? = null,
    @field:Valid
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("children")
    @get:JsonProperty("children")
    val children: kotlin.collections.List<DocNodeDTO>? = null,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("content")
    @get:JsonProperty("content")
    val content: kotlin.String? = null,
    @field:Valid
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("history")
    @get:JsonProperty("history")
    val history: kotlin.collections.List<DocCommitDTO>? = null,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("diff")
    @get:JsonProperty("diff")
    val diff: kotlin.String? = null,
) {}
