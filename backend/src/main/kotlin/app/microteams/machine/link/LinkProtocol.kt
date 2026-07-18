/*
 *  Description: The frozen `link.Msg` wire protocol, ported field-for-field from the
 *               Go CLI's cli/internal/link/link.go. A single flat JSON union carries
 *               every control message in both directions between the server and a
 *               connected machine; only the relevant fields are set per message type
 *               and the rest are omitted (NON_NULL). The CLI never changes, so these
 *               field names / JSON keys are a fixed contract — do not rename them.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty

/** The microteams wire-protocol version this server speaks (matches link.Version = 1). */
const val PROTOCOL_VERSION: Int = 1

/**
 * The union of every field any control message uses. Nullable + NON_NULL so an unset field is
 * simply omitted on the wire — the exact `omitempty` behaviour of the Go struct the CLI
 * marshals/unmarshals. Short JSON keys are the frozen contract.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
data class LinkMsg(
    @get:JsonProperty("t") val t: String,
    @get:JsonProperty("v") val v: Int? = null, // protocol version (hello / welcome)
    @get:JsonProperty("sid") val sid: String? = null,
    @get:JsonProperty("name") val name: String? = null,
    @get:JsonProperty("value") val value: Any? = null,
    @get:JsonProperty("id") val id: String? = null,
    @get:JsonProperty("args") val args: List<Any?>? = null,
    @get:JsonProperty("error") val error: String? = null,
    @get:JsonProperty("command") val command: List<String>? = null,
    @get:JsonProperty("env") val env: Map<String, String>? = null,
    @get:JsonProperty("screen") val screen: String? = null,
    @get:JsonProperty("cols") val cols: Int? = null,
    @get:JsonProperty("rows") val rows: Int? = null,
    @get:JsonProperty("source") val source: String? = null,
    // Adopt marks a session.create that re-drives a screen whose tmux session already
    // survives on the machine (after a server or CLI restart).
    @get:JsonProperty("adopt") val adopt: Boolean? = null,
    // Data carries base64-encoded raw terminal bytes for the direct screen channel
    // (screen.data downstream, screen.input upstream).
    @get:JsonProperty("data") val data: String? = null,
    // One-shot command execution: exec (request) / exec.cancel / exec.result.
    @get:JsonProperty("cwd") val cwd: String? = null,
    @get:JsonProperty("stdin") val stdin: String? = null,
    @get:JsonProperty("timeout") val timeout: Int? = null,
    @get:JsonProperty("stdout") val stdout: String? = null,
    @get:JsonProperty("stderr") val stderr: String? = null,
    @get:JsonProperty("exit") val exit: Int? = null,
    @get:JsonProperty("truncated") val truncated: Boolean? = null,
)

/** The result of a one-shot machine exec (hub.exec → machine → exec.result). */
data class ExecResult(
    val stdout: String,
    val stderr: String,
    val exit: Int,
    val truncated: Boolean,
)
