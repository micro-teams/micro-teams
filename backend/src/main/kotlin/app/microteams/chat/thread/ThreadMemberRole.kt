/*
 *  Description: A thread member's role. Stored as STRING in the database
 *               (@Enumerated), not as an ordinal integer.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.chat.thread

import app.microteams.model.AddMemberRequestDTO
import app.microteams.model.ChangeRoleRequestDTO
import app.microteams.model.ThreadMemberDTO

enum class ThreadMemberRole {
    MEMBER,
    ADMIN,
    OWNER,
}

fun ThreadMemberRole.toDTO(): ThreadMemberDTO.Role =
    when (this) {
        ThreadMemberRole.MEMBER -> ThreadMemberDTO.Role.MEMBER
        ThreadMemberRole.ADMIN -> ThreadMemberDTO.Role.ADMIN
        ThreadMemberRole.OWNER -> ThreadMemberDTO.Role.OWNER
    }

fun AddMemberRequestDTO.Role.toDomain(): ThreadMemberRole =
    when (this) {
        AddMemberRequestDTO.Role.MEMBER -> ThreadMemberRole.MEMBER
        AddMemberRequestDTO.Role.ADMIN -> ThreadMemberRole.ADMIN
        AddMemberRequestDTO.Role.OWNER -> ThreadMemberRole.OWNER
    }

fun ChangeRoleRequestDTO.Role.toDomain(): ThreadMemberRole =
    when (this) {
        ChangeRoleRequestDTO.Role.MEMBER -> ThreadMemberRole.MEMBER
        ChangeRoleRequestDTO.Role.ADMIN -> ThreadMemberRole.ADMIN
        ChangeRoleRequestDTO.Role.OWNER -> ThreadMemberRole.OWNER
    }
