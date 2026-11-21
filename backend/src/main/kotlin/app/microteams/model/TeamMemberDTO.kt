package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param userId
 * @param nickname
 * @param avatarId
 * @param isAgent
 */
data class TeamMemberDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId", required = true)
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(description = "")
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname")
    val nickname: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Long? = null,
    @Schema(description = "")
    @param:JsonProperty("isAgent")
    @get:JsonProperty("isAgent")
    val isAgent: kotlin.Boolean? = null,
) {}
