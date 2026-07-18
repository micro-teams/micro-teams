package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
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
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("path", required = true)
    val path: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("isFolder", required = true)
    val isFolder: kotlin.Boolean,
    @Schema(example = "null", description = "")
    @get:JsonProperty("commitSha")
    val commitSha: kotlin.String? = null,
    @field:Valid
    @Schema(example = "null", description = "")
    @get:JsonProperty("children")
    val children: kotlin.collections.List<DocNodeDTO>? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("content")
    val content: kotlin.String? = null,
    @field:Valid
    @Schema(example = "null", description = "")
    @get:JsonProperty("history")
    val history: kotlin.collections.List<DocCommitDTO>? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("diff")
    val diff: kotlin.String? = null,
) {}
