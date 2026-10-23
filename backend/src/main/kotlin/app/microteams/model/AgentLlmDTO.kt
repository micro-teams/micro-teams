package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/**
 * An agent's model API setting as anyone may read it -- never the key itself.
 *
 * @param provider
 * @param hasApiKey
 * @param api
 * @param baseUrl
 * @param model
 */
data class AgentLlmDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("provider", required = true)
    @get:JsonProperty("provider", required = true)
    val provider: AgentLlmDTO.Provider,
    @Schema(required = true, description = "")
    @param:JsonProperty("hasApiKey", required = true)
    @get:JsonProperty("hasApiKey", required = true)
    val hasApiKey: kotlin.Boolean,
    @Schema(description = "")
    @param:JsonProperty("api")
    @get:JsonProperty("api")
    val api: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("baseUrl")
    @get:JsonProperty("baseUrl")
    val baseUrl: kotlin.String? = null,
    @Schema(description = "")
    @param:JsonProperty("model")
    @get:JsonProperty("model")
    val model: kotlin.String? = null,
) {

    /** Values: deepseek,custom */
    enum class Provider(@get:JsonValue val value: kotlin.String) {

        deepseek("deepseek"),
        custom("custom");

        companion object {
            @JvmStatic
            @JsonCreator
            fun forValue(value: kotlin.String): Provider {
                return values().firstOrNull { it.value == value }
                    ?: throw IllegalArgumentException(
                        "Unexpected value '$value' for enum 'Provider'",
                    )
            }
        }
    }
}
