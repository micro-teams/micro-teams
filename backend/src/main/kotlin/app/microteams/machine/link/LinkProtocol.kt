/*
 *  Description: The control-channel wire protocol between this server and a machine's connector
 *               (micro-connector, docs/protocol.md). A single flat JSON union carries every
 *               message in both directions; only the fields a message type uses are set and the
 *               rest are omitted (NON_NULL), exactly as the connector's Go struct does with
 *               `omitempty`. Unknown fields are ignored, so a newer connector's additions never
 *               break this server.
 *
 *               The protocol version is the `v` of `hello` and `welcome`. Every screen.* message
 *               carries the `viewer` it comes from or goes to; the input lease decides who may
 *               type, and the server mirrors it into `viewerLevel` for the applet.
 *
 *               LinkMsg           the union of every field a message uses.
 *               PROTOCOL_VERSION  the one version this server speaks; a hello announcing any
 *                                 other is refused (LinkHandler).
 *
 *               Example: LinkMsg(t = "screen.subscribe", sid = "s1", viewer = "v1a2b3c4d",
 *                        cols = 120, rows = 32)
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine.link

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty

/** The protocol version this server speaks, as `hello` and `welcome` carry it. */
const val PROTOCOL_VERSION: Int = 2

/**
 * The union of every field any control message uses. Nullable + NON_NULL so an unset field is
 * simply omitted on the wire. The JSON keys are the connector's; they are never renamed.
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
    // Adopt marks a session.create for a screen whose tmux session may already survive on the
    // machine; with an empty command a missing one is reported, never spawned.
    @get:JsonProperty("adopt") val adopt: Boolean? = null,
    // Base64: terminal bytes (screen.data, screen.input) or text (screen.capture.result).
    @get:JsonProperty("data") val data: String? = null,
    // The viewer a screen.* message comes from or goes to.
    @get:JsonProperty("viewer") val viewer: String? = null,
    // Bytes of screen.data a viewer has rendered (screen.ack).
    @get:JsonProperty("n") val n: Int? = null,
    // Take / renew / release (screen.lease).
    @get:JsonProperty("op") val op: String? = null,
    // Who holds the input lease (screen.lease.state): absent when free, "driver", a viewer id.
    @get:JsonProperty("holder") val holder: String? = null,
)
