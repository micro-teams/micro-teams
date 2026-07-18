package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * An agent is a user that software drives. It is not necessarily backed by a screen --
 * machineId/sid are absent for one that is not, or that is not live right now.
 *
 * @param userId
 * @param nickname
 * @param online
 * @param avatarId
 * @param machineId
 * @param sid The live screen id -- present only if the caller may watch it
 * @param teamId
 * @param driver Which driver runs it (claude, codex, ...)
 * @param vars Whatever the driver mirrors up about the live screen (e.g. elapsed, tokens). Opaque
 *   to the machine layer; the UI reads what it recognises.
 */
data class AgentDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("online", required = true)
    val online: kotlin.Boolean,
    @Schema(example = "null", description = "")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Long? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("machineId")
    val machineId: kotlin.String? = null,
    @Schema(
        example = "null",
        description = "The live screen id -- present only if the caller may watch it",
    )
    @get:JsonProperty("sid")
    val sid: kotlin.String? = null,
    @Schema(example = "null", description = "")
    @get:JsonProperty("teamId")
    val teamId: kotlin.Long? = null,
    @Schema(example = "null", description = "Which driver runs it (claude, codex, ...)")
    @get:JsonProperty("driver")
    val driver: kotlin.String? = null,
    @field:Valid
    @Schema(
        example = "null",
        description =
            "Whatever the driver mirrors up about the live screen (e.g. elapsed, tokens). Opaque to the machine layer; the UI reads what it recognises. ",
    )
    @get:JsonProperty("vars")
    val vars: kotlin.collections.Map<kotlin.String, kotlin.Any>? = null,
) {}
