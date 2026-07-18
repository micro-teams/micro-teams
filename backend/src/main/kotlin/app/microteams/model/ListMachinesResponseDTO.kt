package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.Valid

/**
 * @param machines
 * @param page
 */
data class ListMachinesResponseDTO(
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("machines", required = true)
    val machines: kotlin.collections.List<MachineDTO>,
    @field:Valid
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("page", required = true)
    val page: PageDTO,
) {}
