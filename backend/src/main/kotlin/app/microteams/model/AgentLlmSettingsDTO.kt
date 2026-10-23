package app.microteams.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import io.swagger.v3.oas.annotations.media.Schema

/**
 * The model API an agent uses. Send the whole setting each time; apiKey is the one exception:
 * omitted keeps the stored key, an empty string removes it. provider \"none\" clears the setting,
 * so the program falls back to whatever its machine is configured with.
 *
 * @param provider deepseek -- DeepSeek's API (baseUrl optional, for a DeepSeek-compatible
 *   endpoint); custom -- any endpoint speaking one of the protocols in api.
 * @param api The protocol a custom endpoint speaks. Required for custom.
 * @param baseUrl The endpoint, e.g. https://gateway.example/v1. Required for custom.
 * @param model The model id to select. Required for custom; optional for deepseek.
 * @param apiKey Write-only. Omit to keep the stored key; empty string to remove it.
 */
data class AgentLlmSettingsDTO(
    @Schema(
        required = true,
        description =
            "deepseek -- DeepSeek's API (baseUrl optional, for a DeepSeek-compatible endpoint); custom -- any endpoint speaking one of the protocols in api. ",
    )
    @param:JsonProperty("provider", required = true)
    @get:JsonProperty("provider", required = true)
    val provider: AgentLlmSettingsDTO.Provider,
    @Schema(description = "The protocol a custom endpoint speaks. Required for custom.")
    @param:JsonProperty("api")
    @get:JsonProperty("api")
    val api: AgentLlmSettingsDTO.Api? = null,
    @Schema(description = "The endpoint, e.g. https://gateway.example/v1. Required for custom.")
    @param:JsonProperty("baseUrl")
    @get:JsonProperty("baseUrl")
    val baseUrl: kotlin.String? = null,
    @Schema(description = "The model id to select. Required for custom; optional for deepseek.")
    @param:JsonProperty("model")
    @get:JsonProperty("model")
    val model: kotlin.String? = null,
    @Schema(description = "Write-only. Omit to keep the stored key; empty string to remove it.")
    @param:JsonProperty("apiKey")
    @get:JsonProperty("apiKey")
    val apiKey: kotlin.String? = null,
) {

    /**
     * deepseek -- DeepSeek's API (baseUrl optional, for a DeepSeek-compatible endpoint); custom --
     * any endpoint speaking one of the protocols in api. Values: none,deepseek,custom
     */
    enum class Provider(@get:JsonValue val value: kotlin.String) {

        none("none"),
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

    /**
     * The protocol a custom endpoint speaks. Required for custom. Values:
     * openaiMinusCompletions,openaiMinusResponses,anthropicMinusMessages
     */
    enum class Api(@get:JsonValue val value: kotlin.String) {

        openaiMinusCompletions("openai-completions"),
        openaiMinusResponses("openai-responses"),
        anthropicMinusMessages("anthropic-messages");

        companion object {
            @JvmStatic
            @JsonCreator
            fun forValue(value: kotlin.String): Api {
                return values().firstOrNull { it.value == value }
                    ?: throw IllegalArgumentException("Unexpected value '$value' for enum 'Api'")
            }
        }
    }
}
