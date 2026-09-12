package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * An enrolled host running our CLI. It hosts screens; it knows nothing of agents.
 *
 * @param id
 * @param name
 * @param online Whether its control channel is connected right now
 * @param teamIds The teams it serves. Symmetric and owner-less -- a machine may serve many.
 * @param createdAt
 */
data class MachineDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("id", required = true)
    @get:JsonProperty("id", required = true)
    val id: kotlin.String,
    @Schema(required = true, description = "")
    @param:JsonProperty("name", required = true)
    @get:JsonProperty("name", required = true)
    val name: kotlin.String,
    @Schema(required = true, description = "Whether its control channel is connected right now")
    @param:JsonProperty("online", required = true)
    @get:JsonProperty("online", required = true)
    val online: kotlin.Boolean,
    @Schema(
        required = true,
        description = "The teams it serves. Symmetric and owner-less -- a machine may serve many.",
    )
    @param:JsonProperty("teamIds", required = true)
    @get:JsonProperty("teamIds", required = true)
    val teamIds: kotlin.collections.List<kotlin.Long>,
    @Schema(description = "")
    @param:JsonProperty("createdAt")
    @get:JsonProperty("createdAt")
    val createdAt: java.time.OffsetDateTime? = null,
) {}
