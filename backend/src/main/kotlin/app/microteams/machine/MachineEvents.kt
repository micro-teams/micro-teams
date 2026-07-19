/*
 *  Description: What the machine module announces, so that applications running on a machine can
 *               react without the machine module having to know they exist. Deleting a machine
 *               must clean up whatever ran on it, but the cleanup belongs to whoever put it there
 *               — the machine layer reaching into agent tables would invert the dependency it is
 *               the whole point of this module to keep straight.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.machine

/** A machine was forgotten: its token is revoked and anything hosted on it is gone. */
data class MachineForgottenEvent(val machineId: String)

/**
 * A machine's control channel (re)connected and it is online again. Fired on every connect — the
 * very first one included — so a listener must be a no-op when it owns nothing on that machine.
 *
 * Its reason to exist is the hot-upgrade: after a backend redeploy (or a `microteams update`
 * re-exec) the CLI keeps its tmux screens running and reconnects within seconds, but the server has
 * forgotten the in-memory bookkeeping that made those screens *agents*. An application that pins
 * such state to a machine's screens (the agent module) listens for this and re-adopts them, without
 * the machine module having to know they exist — the same one-way dependency MachineForgottenEvent
 * keeps straight, in the opposite direction.
 */
data class MachineConnectedEvent(val machineId: String)
