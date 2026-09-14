package app.microteams

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Regression for the login crash nictheboy hit: @Serializable is inert metadata without the
 * kotlinx-serialization compiler plugin actually applied to this module — the project still
 * compiles either way, so the only thing that catches a dropped plugin is a real
 * encode/decode round trip at runtime, which is what this is.
 */
class SerializationTest {
    private val json = Json

    @Test
    fun loginRequestRoundTrips() {
        val request = LoginRequest("nictheboy", "hunter2")
        val encoded = json.encodeToString(LoginRequest.serializer(), request)
        val decoded = json.decodeFromString(LoginRequest.serializer(), encoded)
        assertEquals(request, decoded)
    }

    @Test
    fun sessionRoundTrips() {
        val session = Session(AuthUser(id = 1, username = "n", nickname = "N"), accessToken = "tok")
        val encoded = json.encodeToString(Session.serializer(), session)
        val decoded = json.decodeFromString(Session.serializer(), encoded)
        assertEquals(session, decoded)
    }
}
