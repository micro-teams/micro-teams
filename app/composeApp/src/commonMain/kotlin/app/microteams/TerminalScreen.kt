package app.microteams

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
 * v0: raw decoded scrollback + one-line-at-a-time input, not a VT100 render. See TerminalSession's
 * doc for why, and the migration backlog for what replaces this.
 */
@Composable
fun TerminalScreen(api: ApiClient, sid: String, title: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val session = remember(sid) { TerminalSession(api, sid) }
    var scrollback by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf("") }

    DisposableEffect(sid) {
        session.connect(scope)
        val job =
            scope.launch {
                for (chunk in session.output) {
                    scrollback += chunk
                }
            }
        onDispose {
            job.cancel()
            scope.launch { session.close() }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(modifier = Modifier.padding(8.dp)) {
            Button(modifier = Modifier.testTag(TestTags.TERMINAL_BACK), onClick = onBack) {
                Text("back")
            }
            Text(title, modifier = Modifier.padding(start = 12.dp))
        }
        SelectionContainer(
            modifier =
                Modifier.weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(8.dp)
                    .testTag(TestTags.TERMINAL_OUTPUT),
        ) {
            Text(scrollback)
        }
        Row(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f).testTag(TestTags.TERMINAL_INPUT),
            )
            Button(
                modifier = Modifier.testTag(TestTags.TERMINAL_SEND),
                onClick = {
                    val text = draft
                    draft = ""
                    scope.launch { session.sendLine(text) }
                },
            ) {
                Text("send")
            }
        }
    }
}
