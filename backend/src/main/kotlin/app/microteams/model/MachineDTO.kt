package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * An enrolled host running our CLI. It hosts screens; it knows nothing of agents.
 *
 * @param id
 * @param name
 * @param online Whether its control channel is connected right now
 * @param teams The teams it is in; anyone who can access one of them can use it.
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
    @field:Valid
    @Schema(
        required = true,
        description = "The teams it is in; anyone who can access one of them can use it.",
    )
    @param:JsonProperty("teams", required = true)
    @get:JsonProperty("teams", required = true)
    val teams: kotlin.collections.List<TeamDTO>,
    @Schema(description = "")
    @param:JsonProperty("createdAt")
    @get:JsonProperty("createdAt")
    val createdAt: java.time.OffsetDateTime? = null,
) {}
