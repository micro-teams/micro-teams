package app.microteams

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun ThreadScreen(api: ApiClient, threadId: Long, title: String, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            messages = api.listMessages(threadId)
        } catch (e: Exception) {
            error = e.message
        }
    }

    LaunchedEffect(threadId) { reload() }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(modifier = Modifier.padding(8.dp)) {
            Button(modifier = Modifier.testTag(TestTags.THREAD_BACK), onClick = onBack) {
                Text("back")
            }
            Text(title, modifier = Modifier.padding(start = 12.dp))
        }
        when {
            error != null -> Text(error!!, modifier = Modifier.padding(16.dp))
            messages == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            else ->
                LazyColumn(modifier = Modifier.weight(1f)) {
                    items(messages!!) { m ->
                        Text(
                            m.content,
                            modifier = Modifier.padding(8.dp).testTag(TestTags.threadMessage(m.id)),
                        )
                    }
                }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f).testTag(TestTags.THREAD_INPUT),
            )
            Button(
                modifier = Modifier.testTag(TestTags.THREAD_SEND),
                onClick = {
                    val text = draft
                    if (text.isNotBlank()) {
                        draft = ""
                        scope.launch {
                            try {
                                api.postMessage(threadId, text)
                                reload()
                            } catch (e: Exception) {
                                error = e.message
                            }
                        }
                    }
                },
            ) {
                Text("send")
            }
        }
    }
}
