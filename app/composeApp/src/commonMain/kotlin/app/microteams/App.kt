package app.microteams

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * Where a screen/form-factor/platform difference belongs: NOT a second class. This one composable
 * is the whole app on every target; androidMain/wasmJsMain only ever swap out httpEngine() and the
 * eventual terminal-rendering widget underneath it (see HttpEngine.kt). A wide-vs-narrow layout
 * difference, when this grows one, branches inside a single composable with BoxWithConstraints —
 * never a second type either. See the T-092/T-091 aftermath conversation for why this is written
 * down here and not assumed.
 */
sealed class Screen {
    object Login : Screen()
    object Home : Screen()
    data class Thread(val threadId: Long, val title: String) : Screen()
    data class Terminal(val sid: String, val title: String) : Screen()
}

@Composable
fun App() {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            var baseUrl by remember { mutableStateOf("") }
            var api by remember { mutableStateOf<ApiClient?>(null) }
            var screen by remember { mutableStateOf<Screen>(Screen.Login) }

            val current = api
            if (current == null) {
                LoginScreen(
                    initialBaseUrl = baseUrl,
                    onSignedIn = { url, client ->
                        baseUrl = url
                        api = client
                        screen = Screen.Home
                    },
                )
            } else {
                when (val s = screen) {
                    is Screen.Login,
                    is Screen.Home ->
                        HomeScreen(
                            api = current,
                            onOpenThread = { id, title -> screen = Screen.Thread(id, title) },
                            onOpenTerminal = { sid, title -> screen = Screen.Terminal(sid, title) },
                        )
                    is Screen.Thread ->
                        ThreadScreen(
                            api = current,
                            threadId = s.threadId,
                            title = s.title,
                            onBack = { screen = Screen.Home },
                        )
                    is Screen.Terminal ->
                        TerminalScreen(
                            api = current,
                            sid = s.sid,
                            title = s.title,
                            onBack = { screen = Screen.Home },
                        )
                }
            }
        }
    }
}
