package app.microteams

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive

class ApiError(message: String) : Exception(message)

/**
 * Everything the app says to the server, over one origin. `baseUrl` is the outer gateway
 * (deploy/nginx.conf): cheese-auth is mounted there at `/api` (prefix stripped), and the backend
 * itself at `/mt` (prefix kept — its own routes are `/chat`, `/machine`, `/agent`, matching
 * MicroTeams-API.yml). One base URL covers both because that is how every deployment this app has
 * ever run against is fronted; a second one has never been needed.
 */
class ApiClient(private val baseUrl: String) {
    private val json = Json { ignoreUnknownKeys = true }

    private val client =
        HttpClient(httpEngine()) {
            install(ContentNegotiation) { json(json) }
            install(WebSockets)
        }

    var accessToken: String? = null
        private set

    private fun httpBase() = baseUrl.trimEnd('/')

    /** wss://… or ws://…, from whatever scheme baseUrl was given in. */
    private fun wsBase() =
        httpBase().replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")

    // -- cheese-auth: enveloped {code, message, data} ------------------------------------------

    suspend fun login(username: String, password: String): Session {
        val response = client.post("${httpBase()}/api/users/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(username, password))
        }
        val session = unwrapEnveloped<Session>(response)
        accessToken = session.accessToken
        return session
    }

    private suspend inline fun <reified T> unwrapEnveloped(response: HttpResponse): T {
        val envelope = response.body<JsonObject>()
        if (!response.status.isSuccess()) {
            val message = envelope["message"]?.jsonPrimitive?.contentOrNull ?: response.status.toString()
            throw ApiError(message)
        }
        val data = envelope["data"] ?: throw ApiError("empty response")
        return json.decodeFromJsonElement(data)
    }

    // -- backend: plain JSON, Authorization: Bearer ---------------------------------------------

    private suspend inline fun <reified T> authedGet(path: String): T {
        val token = accessToken ?: throw ApiError("not signed in")
        val response = client.get("${httpBase()}$path") { header("Authorization", "Bearer $token") }
        if (!response.status.isSuccess()) throw ApiError(response.status.toString())
        return response.body()
    }

    private suspend inline fun <reified Req, reified Res> authedPost(path: String, body: Req): Res {
        val token = accessToken ?: throw ApiError("not signed in")
        val response =
            client.post("${httpBase()}$path") {
                header("Authorization", "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
        if (!response.status.isSuccess()) throw ApiError(response.status.toString())
        return response.body()
    }

    suspend fun listChats(): List<ChatSummary> = authedGet<ListChatsResponse>("/mt/chat").chats

    suspend fun listMessages(threadId: Long): List<Message> =
        authedGet<ListMessagesResponse>("/mt/chat/$threadId/messages").messages

    suspend fun postMessage(threadId: Long, content: String): Message =
        authedPost("/mt/chat/$threadId/messages", PostMessageRequest(content))

    suspend fun listMachines(): List<Machine> =
        authedGet<ListMachinesResponse>("/mt/machine").machines

    suspend fun listAgents(teamId: Long? = null, online: Boolean? = null): List<Agent> {
        val query = buildString {
            val parts = buildList {
                if (teamId != null) add("teamId=$teamId")
                if (online != null) add("online=$online")
            }
            if (parts.isNotEmpty()) append("?" + parts.joinToString("&"))
        }
        return authedGet<ListAgentsResponse>("/mt/agent$query").agents
    }

    suspend fun openAgent(machineId: String, teamId: Long): OpenedAgent =
        authedPost("/mt/agent", OpenAgentRequest(machineId, teamId))

    /** The token a screen websocket is opened with: the user's own, exactly as the legacy app did
     * for an already-live agent (see terminal_screen.dart). */
    fun screenSocketUrl(sid: String): String {
        val token = accessToken ?: throw ApiError("not signed in")
        return "${wsBase()}/mt/machine/screen/$sid?token=$token"
    }

    val ws: HttpClient get() = client
}
