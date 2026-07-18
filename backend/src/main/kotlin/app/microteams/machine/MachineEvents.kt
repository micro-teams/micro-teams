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
