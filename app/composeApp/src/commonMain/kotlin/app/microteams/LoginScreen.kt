package app.microteams

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * No "server URL" build flavor: v0 is meant to be pointed at whatever deployment is being tested
 * (a real bundle, a dev backend, ...) without a rebuild, exactly like `microteams api ...` takes a
 * base URL rather than baking one in.
 */
@Composable
fun LoginScreen(initialBaseUrl: String, onSignedIn: (String, ApiClient) -> Unit) {
    var baseUrl by remember { mutableStateOf(initialBaseUrl) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("MicroTeams")
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("server URL (e.g. https://microteams.app)") },
            modifier = Modifier.fillMaxWidth().testTag(TestTags.LOGIN_SERVER_URL),
        )
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("username") },
            modifier = Modifier.fillMaxWidth().testTag(TestTags.LOGIN_USERNAME),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("password") },
            modifier = Modifier.fillMaxWidth().testTag(TestTags.LOGIN_PASSWORD),
        )
        if (error != null) Text(error!!, modifier = Modifier.testTag(TestTags.LOGIN_ERROR))
        if (loading) {
            CircularProgressIndicator()
        } else {
            Button(
                modifier = Modifier.testTag(TestTags.LOGIN_SUBMIT),
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            val client = ApiClient(baseUrl)
                            client.login(username, password)
                            onSignedIn(baseUrl, client)
                        } catch (e: Exception) {
                            error = e.message ?: "sign-in failed"
                        } finally {
                            loading = false
                        }
                    }
                },
            ) {
                Text("sign in")
            }
        }
    }
}
