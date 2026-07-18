/*
 *  Description: Responsible for creating users in the legacy system and logging in.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.utils

import app.microteams.user.*
import at.favre.lib.crypto.bcrypt.BCrypt
import jakarta.ws.rs.client.ClientBuilder
import jakarta.ws.rs.client.Entity
import jakarta.ws.rs.core.MediaType
import kotlin.math.floor
import org.json.JSONObject
import org.rucca.cheese.common.config.ApplicationConfig
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

@Service
class UserCreatorService(
    private val applicationConfig: ApplicationConfig,
    private val userRepository: UserRepository,
    private val userProfileRepository: UserProfileRepository,
) {
    class CreateUserResponse(
        val userId: IdType,
        val username: String,
        val password: String,
        val email: String,
        val nickname: String,
        val avatarId: IdType,
        val intro: String,
    )

    fun createUser(
        username: String = testUsername(),
        password: String = testPassword(),
        email: String = testEmail(),
        nickname: String = testNickname(),
        avatarId: IdType = testAvatarId(),
        intro: String = testIntro(),
    ): CreateUserResponse {
        val user = User()
        user.username = username
        user.hashedPassword = BCrypt.withDefaults().hashToString(12, password.toCharArray())
        user.email = email
        val userId = userRepository.save(user).id!!
        val userProfile = UserProfile()
        userProfile.nickname = nickname
        userProfile.avatar = Avatar().also { it.id = avatarId.toInt() }
        userProfile.intro = intro
        userProfile.user = user
        userProfileRepository.save(userProfile)
        return CreateUserResponse(
            userId.toLong(),
            username,
            password,
            email,
            nickname,
            avatarId,
            intro,
        )
    }

    /** @return JWT token */
    fun login(username: String, password: String): String {
        val client = ClientBuilder.newClient()
        val target = client.target(applicationConfig.legacyUrl).path("/users/auth/login")
        val request =
            """
            {
                "username": "$username",
                "password": "$password"
            }
        """
        val response = target.request().post(Entity.entity(request, MediaType.APPLICATION_JSON))
        val result = JSONObject(response.readEntity(String::class.java))
        try {
            return result.getJSONObject("data").getString("accessToken")
        } catch (e: Exception) {
            throw RuntimeException("Failed to login: $result")
        }
    }

    fun testUsername(): String {
        return "NTTestUsername-${floor(Math.random() * 10000000000).toLong()}"
    }

    fun testPassword(): String {
        return "abc123456!!!"
    }

    fun testEmail(): String {
        return "test-${floor(Math.random() * 10000000000).toLong()}@ruc.edu.cn"
    }

    fun testNickname(): String {
        return "test_user"
    }

    fun testAvatarId(): IdType {
        return 1
    }

    fun testIntro(): String {
        return "This user has not set an introduction yet."
    }
}
