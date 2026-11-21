package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param teamId */
data class AddSubteamRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("teamId", required = true)
    @get:JsonProperty("teamId", required = true)
    val teamId: kotlin.Long,
) {}
