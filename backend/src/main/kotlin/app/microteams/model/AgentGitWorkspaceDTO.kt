package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param gitUrl The team document tree's git remote (e.g. https://host/mt/git/42) — clone/pull/push
 *   here.
 * @param token A short-lived JWT to authenticate git, sent as an Authorization Bearer header.
 * @param teamId The team whose document tree this workspace is.
 */
data class AgentGitWorkspaceDTO(
    @Schema(
        required = true,
        description =
            "The team document tree's git remote (e.g. https://host/mt/git/42) — clone/pull/push here.",
    )
    @param:JsonProperty("gitUrl", required = true)
    @get:JsonProperty("gitUrl", required = true)
    val gitUrl: kotlin.String,
    @Schema(
        required = true,
        description =
            "A short-lived JWT to authenticate git, sent as an Authorization Bearer header.",
    )
    @param:JsonProperty("token", required = true)
    @get:JsonProperty("token", required = true)
    val token: kotlin.String,
    @Schema(required = true, description = "The team whose document tree this workspace is.")
    @param:JsonProperty("teamId", required = true)
    @get:JsonProperty("teamId", required = true)
    val teamId: kotlin.Long,
) {}
