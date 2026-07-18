/*
 *  Description: This file implements the TopicService class.
 *               It is responsible for providing user's DTO.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *      nameisyui
 *
 */

package app.microteams.user

import app.microteams.model.UserDTO
import org.rucca.cheese.common.error.NotFoundError
import org.rucca.cheese.common.persistent.IdType
import org.springframework.stereotype.Service

@Service
class UserService(
    private val userRepository: UserRepository,
    private val userProfileRepository: UserProfileRepository,
) {
    fun getUserDto(userId: IdType): UserDTO {
        val user =
            userRepository.findById(userId.toInt()).orElseThrow { NotFoundError("user", userId) }
        val profile =
            userProfileRepository.findByUserId(userId.toInt()).orElseThrow {
                RuntimeException("UserProfile not found for user $userId")
            }
        return UserDTO(
            avatarId = profile.avatar!!.id!!.toLong(),
            id = user.id!!.toLong(),
            intro = profile.intro!!,
            nickname = profile.nickname!!,
            username = user.username!!,
        )
    }

    fun getUserAvatarId(userId: IdType): IdType {
        val profile =
            userProfileRepository.findByUserId(userId.toInt()).orElseThrow {
                NotFoundError("user", userId)
            }
        return profile.avatar!!.id!!.toLong()
    }

    fun existsUser(userId: IdType): Boolean {
        return userRepository.existsById(userId.toInt())
    }
}
