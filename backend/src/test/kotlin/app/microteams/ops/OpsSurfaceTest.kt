/*
 *  Description: The operator surface's one security claim, tested where it would actually fail.
 *
 *               The claim is not "the public port rejects the operator token". It is that the
 *               public port has nothing that could accept it — so the test worth writing runs the
 *               application WITHOUT a separate management port, which is the shipped default, and
 *               asserts the ops endpoints are not there at all. If someone later mounts the filter
 *               or the controller on the application context to make something convenient work,
 *               this is what goes red.
 *
 *               The token deliberately IS configured here. A test that left it blank would pass for
 *               the wrong reason — "there is no token" rather than "there is no surface".
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.ops

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = ["application.ops.token=a-real-operator-token"])
class OpsSurfaceTest @Autowired constructor(private val mockMvc: MockMvc) {

    /**
     * The whole point. With management on the application port (the default), the ops beans are not
     * created, so the public application does not serve these paths — with or without the token.
     */
    @Test
    fun `the ops endpoints do not exist on the public application`() {
        mockMvc
            .perform(get("/ops/machines").header("X-Ops-Token", "a-real-operator-token"))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `the ops update action does not exist on the public application either`() {
        mockMvc
            .perform(
                post("/ops/machines/anything/update").header("X-Ops-Token", "a-real-operator-token")
            )
            .andExpect(status().isNotFound)
    }

    /** And it is not merely that the path is unauthenticated-404: no token behaves the same way. */
    @Test
    fun `an ops path without a token is equally absent`() {
        mockMvc.perform(get("/ops/machines")).andExpect(status().isNotFound)
    }
}
