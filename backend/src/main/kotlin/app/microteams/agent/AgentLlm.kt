/*
 *  Description: Which model API an agent uses — for drivers whose program takes its model endpoint
 *               from MicroTeams rather than from the machine (today: dsh, DeepSeek Harness).
 *
 *               Two shapes. `deepseek`: a DeepSeek API key, optionally with a DeepSeek-compatible
 *               base URL and a model to select. `custom`: any endpoint speaking OpenAI Chat
 *               Completions, OpenAI Responses or Anthropic Messages, with its base URL, key and
 *               model. Per agent rather than per machine, so two agents on one machine can bill to
 *               different keys and one key can be revoked without touching the others.
 *
 *               The key is write-only: the API reports whether one is set and never returns it. It
 *               reaches the program the way the screen token does — in the screen's environment at
 *               launch (see AgentService.screenEnv) — so a change takes effect on the next start.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.agent

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.net.URI
import org.rucca.cheese.common.error.BadRequestError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Entity
@Table(name = "agent_llm")
class AgentLlm(
    @Id @Column(name = "agent_user_id") var agentUserId: IdType = 0,
    // "deepseek" or "custom".
    @Column(nullable = false, length = 16) var provider: String = "",
    // The protocol a custom endpoint speaks: openai-completions | openai-responses |
    // anthropic-messages. Null for deepseek.
    @Column(length = 32) var api: String? = null,
    @Column(name = "base_url", length = 512) var baseUrl: String? = null,
    @Column(length = 256) var model: String? = null,
    // Never returned by the API. Stored as given, like the screen and machine tokens.
    @Column(name = "api_key", length = 1024) var apiKey: String? = null,
)

interface AgentLlmRepository : JpaRepository<AgentLlm, IdType>

/** A requested change, already parsed out of the API's DTO. apiKey null = keep the stored one. */
data class AgentLlmChange(
    val provider: String,
    val api: String?,
    val baseUrl: String?,
    val model: String?,
    val apiKey: String?,
)

@Service
class AgentLlmService(private val repository: AgentLlmRepository) {
    companion object {
        val PROVIDERS = setOf("none", "deepseek", "custom")
        val APIS = setOf("openai-completions", "openai-responses", "anthropic-messages")
    }

    fun get(agentUserId: IdType): AgentLlm? = repository.findById(agentUserId).orElse(null)

    /** Validate and store [change] for the agent; provider "none" removes the setting. */
    @Transactional
    fun set(agentUserId: IdType, change: AgentLlmChange) {
        validate(change)
        if (change.provider == "none") {
            if (repository.existsById(agentUserId)) repository.deleteById(agentUserId)
            return
        }
        val row = get(agentUserId) ?: AgentLlm(agentUserId = agentUserId)
        row.provider = change.provider
        row.api = if (change.provider == "custom") clean(change.api) else null
        row.baseUrl = clean(change.baseUrl)
        row.model = clean(change.model)
        when {
            change.apiKey == null -> {} // keep
            change.apiKey.isBlank() -> row.apiKey = null
            else -> row.apiKey = change.apiKey.trim()
        }
        repository.save(row)
    }

    /** Throw a BadRequestError describing what is wrong with [change], if anything. */
    fun validate(change: AgentLlmChange) {
        if (change.provider !in PROVIDERS) {
            throw BadRequestError("provider must be one of ${PROVIDERS.joinToString(", ")}")
        }
        if (change.provider == "none") return
        val baseUrl = clean(change.baseUrl)
        val model = clean(change.model)
        val api = clean(change.api)
        if (baseUrl != null) requireHttpUrl(baseUrl)
        if (change.provider == "custom") {
            if (api == null || api !in APIS) {
                throw BadRequestError(
                    "a custom provider needs api: one of ${APIS.joinToString(", ")}",
                )
            }
            if (baseUrl == null) throw BadRequestError("a custom provider needs baseUrl")
            if (model == null) throw BadRequestError("a custom provider needs model")
        }
        for ((name, value) in listOf("model" to model, "apiKey" to change.apiKey)) {
            if (value != null && value.any { it == '\n' || it == '\r' || it == '\u0000' }) {
                throw BadRequestError("$name must be a single line")
            }
        }
    }

    private fun clean(v: String?): String? = v?.trim()?.takeIf { it.isNotEmpty() }

    /**
     * What a screen's environment carries for this agent, read by the driver's launch command.
     * Empty when nothing is set, so a program falls back to its machine's own configuration.
     */
    fun screenEnv(agentUserId: IdType): Map<String, String> {
        val row = get(agentUserId) ?: return emptyMap()
        return buildMap {
            put("MICROTEAMS_LLM_PROVIDER", row.provider)
            row.api?.let { put("MICROTEAMS_LLM_API", it) }
            row.baseUrl?.let { put("MICROTEAMS_LLM_BASE_URL", it) }
            row.model?.let { put("MICROTEAMS_LLM_MODEL", it) }
            row.apiKey?.let { put("MICROTEAMS_LLM_API_KEY", it) }
        }
    }

    /** Remove the setting with the agent. */
    @Transactional
    fun forget(agentUserId: IdType) {
        if (repository.existsById(agentUserId)) repository.deleteById(agentUserId)
    }

    private fun requireHttpUrl(url: String) {
        val uri = runCatching { URI(url) }.getOrNull()
        if (
            uri == null ||
                (uri.scheme != "http" && uri.scheme != "https") ||
                uri.host.isNullOrEmpty()
        ) {
            throw BadRequestError("baseUrl must be an http(s) URL")
        }
    }
}
