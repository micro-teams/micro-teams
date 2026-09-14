package app.microteams

import kotlinx.serialization.Serializable

@Serializable
data class AuthUser(
    val id: Long = 0,
    val username: String = "",
    val nickname: String = "",
)

@Serializable
data class Session(val user: AuthUser, val accessToken: String)

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class ChatMember(val userId: Long = 0, val nickname: String = "")

@Serializable
data class ChatLastMessage(val content: String = "", val senderId: Long = 0)

@Serializable
data class ChatSummary(
    val id: Long,
    val title: String = "",
    val members: List<ChatMember> = emptyList(),
    val lastMessage: ChatLastMessage? = null,
)

@Serializable
data class ListChatsResponse(val chats: List<ChatSummary> = emptyList())

@Serializable
data class Message(
    val id: Long = 0,
    val threadId: Long = 0,
    val senderId: Long = 0,
    val content: String = "",
)

@Serializable
data class ListMessagesResponse(val messages: List<Message> = emptyList())

@Serializable
data class PostMessageRequest(val content: String)

@Serializable
data class Machine(val id: String, val name: String = "", val online: Boolean = false)

@Serializable
data class ListMachinesResponse(val machines: List<Machine> = emptyList())

@Serializable
data class Agent(
    val userId: Long = 0,
    val nickname: String = "",
    val online: Boolean = false,
    val machineId: String? = null,
    val sid: String? = null,
)

@Serializable
data class ListAgentsResponse(val agents: List<Agent> = emptyList())

@Serializable
data class OpenAgentRequest(
    val machineId: String,
    val teamId: Long,
    val driver: String? = null,
)

@Serializable
data class OpenedAgent(
    val agentUserId: Long,
    val sid: String,
    val machineId: String,
    val screenToken: String,
)
