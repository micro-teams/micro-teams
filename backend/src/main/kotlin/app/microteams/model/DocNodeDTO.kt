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
    @Schema(required = true, description = "")
    @param:JsonProperty("path", required = true)
    @get:JsonProperty("path", required = true)
    val path: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("isFolder", required = true)
    @get:JsonProperty("isFolder", required = true)
    val isFolder: kotlin.Boolean,
    @Schema(description = "")
    @param:JsonProperty("commitSha")
    @get:JsonProperty("commitSha")
    val commitSha: kotlin.String? = null,
    @field:Valid
    @Schema(description = "")
    @param:JsonProperty("children")
    @get:JsonProperty("children")
    val children: kotlin.collections.List<DocNodeDTO>? = null,
    @Schema(description = "")
    @param:JsonProperty("content")
    @get:JsonProperty("content")
    val content: kotlin.String? = null,
    @field:Valid
    @Schema(description = "")
    @param:JsonProperty("history")
    @get:JsonProperty("history")
    val history: kotlin.collections.List<DocCommitDTO>? = null,
    @Schema(description = "")
    @param:JsonProperty("diff")
    @get:JsonProperty("diff")
    val diff: kotlin.String? = null,
) {}
