package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param thread
 * @param members
 * @param teams The teams the thread is in; anyone who can access one of them can read it.
 * @param isMember Whether the caller is a member (may speak), not only a reader.
 */
data class ThreadDetailDTO(
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("thread", required = true)
    @get:JsonProperty("thread", required = true)
    val thread: ThreadDTO,
    @field:Valid
    @Schema(required = true, description = "")
    @param:JsonProperty("members", required = true)
    @get:JsonProperty("members", required = true)
    val members: kotlin.collections.List<ThreadMemberDTO>,
    @field:Valid
    @Schema(
        required = true,
        description = "The teams the thread is in; anyone who can access one of them can read it.",
    )
    @param:JsonProperty("teams", required = true)
    @get:JsonProperty("teams", required = true)
    val teams: kotlin.collections.List<TeamDTO>,
    @Schema(
        required = true,
        description = "Whether the caller is a member (may speak), not only a reader.",
    )
    @param:JsonProperty("isMember", required = true)
    @get:JsonProperty("isMember", required = true)
    val isMember: kotlin.Boolean,
) {}
