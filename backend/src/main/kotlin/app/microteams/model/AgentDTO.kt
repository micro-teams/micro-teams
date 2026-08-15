package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
 * @param keepalive
 */
data class AgentDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("userId")
    @get:JsonProperty("userId", required = true)
    val userId: kotlin.Long,
    @Schema(required = true, description = "")
    @param:JsonProperty("nickname")
    @get:JsonProperty("nickname", required = true)
    val nickname: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("online")
    @get:JsonProperty("online", required = true)
    val online: kotlin.Boolean,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("avatarId")
    @get:JsonProperty("avatarId")
    val avatarId: kotlin.Long? = null,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("machineId")
    @get:JsonProperty("machineId")
    val machineId: kotlin.String? = null,
    @Schema(description = "The live screen id -- present only if the caller may watch it")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("sid")
    @get:JsonProperty("sid")
    val sid: kotlin.String? = null,
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("teamId")
    @get:JsonProperty("teamId")
    val teamId: kotlin.Long? = null,
    @Schema(description = "Which driver runs it (claude, codex, ...)")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("driver")
    @get:JsonProperty("driver")
    val driver: kotlin.String? = null,
    @field:Valid
    @Schema(
        description =
            "Whatever the driver mirrors up about the live screen (e.g. elapsed, tokens). Opaque to the machine layer; the UI reads what it recognises. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("vars")
    @get:JsonProperty("vars")
    val vars: kotlin.collections.Map<kotlin.String, kotlin.Any>? = null,
    @field:Valid
    @Schema(description = "")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("keepalive")
    @get:JsonProperty("keepalive")
    val keepalive: AgentKeepaliveDTO? = null,
) {}
