/*
 *  Description: Unit tests for the UserCreatorService class
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test
import org.rucca.cheese.utils.UserCreatorService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

@Disabled("Disabled to speed up tests")
@SpringBootTest
class UserCreatorServiceTest
@Autowired
constructor(private val userCreatorService: UserCreatorService) {
    private val logger = LoggerFactory.getLogger(UserCreatorServiceTest::class.java)

    @Test
    fun createUserAndLogin() {
        val response = userCreatorService.createUser()
        val token = userCreatorService.login(response.username, response.password)
        logger.info("Token: $token")
    }
}
