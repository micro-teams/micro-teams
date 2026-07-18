/*
 *  Description: A controller class for testing the AuthorizationAspect class
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.rucca.cheese.auth.annotation.AuthInfo
import org.rucca.cheese.auth.annotation.Guard
import org.rucca.cheese.auth.annotation.NoAuth
import org.rucca.cheese.auth.annotation.ResourceId
import org.rucca.cheese.common.persistent.IdType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
class ExampleRestController {
    @GetMapping("/example/1")
    fun withoutGuardOrNoAuth(): String {
        return "example_1"
    }

    @GetMapping("/example/2")
    @Guard("query", "example")
    fun duplicatedResourceId(
        @RequestParam("id1") @ResourceId id1: IdType,
        @RequestParam("id2") @ResourceId id2: IdType,
    ): String {
        return "example_2"
    }

    @GetMapping("/example/3")
    @Guard("query", "example")
    fun resourceIdMismatch(@RequestParam("id") @ResourceId id: String): String {
        return "example_3"
    }

    @GetMapping("/example/4")
    @Guard("query", "example")
    fun withoutId(): String {
        return "example_4"
    }

    @GetMapping("/example/5")
    @Guard("query", "example")
    fun withId(@RequestParam("id") @ResourceId id: IdType): String {
        return "example_5"
    }

    @GetMapping("/example/6")
    @NoAuth
    fun noAuth(): String {
        return "example_6"
    }

    @GetMapping("/example/7")
    @Guard("query", "example")
    fun withIdAndAdditional(
        @RequestParam("id") @ResourceId id: IdType,
        @RequestParam("additional_str") @AuthInfo("str") additionalStr: String,
        @RequestParam("additional_id") @AuthInfo("id") additionalId: IdType,
    ): String {
        return "example_7"
    }

    @GetMapping("/example/8")
    @Guard("query", "example")
    fun withDuplicatedAuthInfo(
        @RequestParam("additional_1") @AuthInfo("key") additionalStr: String,
        @RequestParam("additional_2") @AuthInfo("key") additionalId: IdType,
    ): String {
        return "example_8"
    }
}
