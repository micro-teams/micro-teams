package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param thread
 * @param members
 */
data class ThreadDetailDTO(
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("thread", required = true)
    val thread: ThreadDTO,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<ThreadMemberDTO>,
) {}
