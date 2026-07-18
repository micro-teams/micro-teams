/*
 *  Description: Unit tests for the AuthorizationService class
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import kotlin.test.assertEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.rucca.cheese.common.persistent.IdType
import org.rucca.cheese.utils.UserCreatorService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

@Disabled("Disabled to speed up tests")
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthorizationServiceTest
@Autowired
constructor(
    private val authorizationService: AuthorizationService,
    private val userCreatorService: UserCreatorService,
) {
    var userId: IdType = -1
    lateinit var token: String

    @BeforeAll
    fun prepare() {
        val user = userCreatorService.createUser()
        userId = user.userId
        token = userCreatorService.login(user.username, user.password)
    }

    @Test
    fun testVerify() {
        val authorization = authorizationService.verify(token)
        assertEquals(userId, authorization.userId)
    }
}
