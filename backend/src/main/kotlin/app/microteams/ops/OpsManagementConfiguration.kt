/*
 *  Description: Where the operator surface is mounted, and the reason it can only be mounted there.
 *
 *               Spring Boot builds a separate child application context for the management port, and
 *               a `@ManagementContextConfiguration(CHILD)` is loaded into that context ONLY. So the
 *               controller and the token filter below exist on the management port and nowhere else
 *               — not because a rule rejects them elsewhere, but because the public application
 *               never constructs them.
 *
 *               Two halves make that true, and both are needed:
 *
 *               1. app.microteams.ops is excluded from the application's component scan
 *                  (see BackendApplication). Without that, Spring would find these classes on the
 *                  public side by annotation alone — and a Filter bean found there is applied to
 *                  every public request, which is precisely the leak this design exists to prevent.
 *                  That is not hypothetical: it is what happened on the first attempt.
 *
 *               2. They are declared here as beans instead.
 *
 *               With no management port configured, this file is never loaded and the ops surface
 *               simply does not exist. That is the intended default: an operator API should be
 *               something a deployment turns on deliberately.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ops

import app.microteams.machine.enrollment.MachineRepository
import app.microteams.machine.link.MachineHub
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.actuate.autoconfigure.web.ManagementContextConfiguration
import org.springframework.boot.actuate.autoconfigure.web.ManagementContextType
import org.springframework.context.annotation.Bean

@ManagementContextConfiguration(ManagementContextType.CHILD)
class OpsManagementConfiguration {

    @Bean
    fun opsAuthFilter(@Value("\${application.ops.token:}") token: String): OpsAuthFilter =
        OpsAuthFilter(token)

    @Bean
    fun opsMachineController(
        hub: MachineHub,
        machineRepository: MachineRepository,
    ): OpsMachineController = OpsMachineController(hub, machineRepository)
}
