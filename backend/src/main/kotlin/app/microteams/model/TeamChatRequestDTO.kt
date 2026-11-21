package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * Either threadId (put an existing thread into the team) or title (create one in it).
 *
 * @param threadId
 * @param title
 * @param memberIds
 */
data class TeamChatRequestDTO(
    @Schema(description = "")
    @param:JsonProperty("threadId")
    @get:JsonProperty("threadId")
    val threadId: kotlin.Long? = null,
    @Schema(description = "")
    @param:JsonProperty("title")
    @get:JsonProperty("title")
    val title: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("memberIds")
    @get:JsonProperty("memberIds")
    val memberIds: kotlin.collections.List<kotlin.Long>? = null,
) {}
