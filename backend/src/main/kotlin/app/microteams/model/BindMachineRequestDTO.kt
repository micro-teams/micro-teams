package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/** @param machineId */
data class BindMachineRequestDTO(
    @Schema(example = "null", required = true, description = "")
    @get:JsonProperty("machineId", required = true)
    val machineId: kotlin.String
) {}
