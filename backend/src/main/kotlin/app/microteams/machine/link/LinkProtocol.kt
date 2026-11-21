/*
 *  Description: The control-channel wire protocol between this server and a machine's connector
 *               (micro-connector, docs/protocol.md). A single flat JSON union carries every
 *               message in both directions; only the fields a message type uses are set and the
 *               rest are omitted (NON_NULL), exactly as the connector's Go struct does with
 *               `omitempty`. Unknown fields are ignored, so a newer connector's additions never
 *               break this server.
 *
 *               Two protocol versions are spoken, chosen per machine by the `v` of its `hello`:
 *
 *                 PROTOCOL_V1  connectors up to micro-connector v0.1.7. One shared viewer per
 *                              screen: screen.subscribe / resize / unsubscribe / input carry no
 *                              viewer id, screen.data goes to every viewer, scrolling is
 *                              `screen.scroll {dir}`, and who may type is the applet-observed
 *                              `viewerLevel` variable.
 *                 PROTOCOL_V2  per-viewer screens: every screen.* message carries `viewer`;
 *                              machine -> server adds screen.size, screen.lease.state,
 *                              screen.capture.result and screen.error; server -> machine adds
 *                              screen.ack, screen.lease and screen.capture; screen.scroll is gone
 *                              (the wheel is mouse input). The input lease decides who may type;
 *                              the server mirrors it into `viewerLevel` for the applet.
 *
 *               LinkMsg     the union of every field either version uses.
 *               PROTOCOL_V1, PROTOCOL_V2  the version numbers, as `hello` / `welcome` carry them.
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

/** One shared viewer per screen, viewerLevel set by typing, screen.scroll. */
const val PROTOCOL_V1: Int = 1

/** Per-viewer screens, the input lease, acks and capture. */
const val PROTOCOL_V2: Int = 2

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
    // v1 only: the direction of a screen.scroll ("up" / "down" / "bottom").
    @get:JsonProperty("dir") val dir: String? = null,
    // v2: the viewer a screen.* message comes from or goes to.
    @get:JsonProperty("viewer") val viewer: String? = null,
    // v2: bytes of screen.data a viewer has rendered (screen.ack).
    @get:JsonProperty("n") val n: Int? = null,
    // v2: take / renew / release (screen.lease).
    @get:JsonProperty("op") val op: String? = null,
    // v2: who holds the input lease (screen.lease.state): absent when free, "driver", a viewer id.
    @get:JsonProperty("holder") val holder: String? = null,
)
