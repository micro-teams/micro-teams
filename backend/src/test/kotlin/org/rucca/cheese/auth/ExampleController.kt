/*
 *  Description: A controller class for testing the AuthorizationAspect class
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.ResourceId
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam

@Controller
class ExampleController {
    @GetMapping("/example2/1")
    @Guard("query", "example")
    fun withId(@RequestParam("id") @ResourceId id: IdType): String {
        return "example_1"
    }
}
