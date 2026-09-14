package app.microteams

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen(
    api: ApiClient,
    onOpenThread: (Long, String) -> Unit,
    onOpenTerminal: (String, String) -> Unit,
) {
    var tab by remember { mutableStateOf(0) }

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab) {
            Tab(
                selected = tab == 0,
                onClick = { tab = 0 },
                text = { Text("chats") },
                modifier = Modifier.testTag(TestTags.TAB_CHATS),
            )
            Tab(
                selected = tab == 1,
                onClick = { tab = 1 },
                text = { Text("machines") },
                modifier = Modifier.testTag(TestTags.TAB_MACHINES),
            )
        }
        when (tab) {
            0 -> ChatsTab(api, onOpenThread)
            else -> MachinesTab(api, onOpenTerminal)
        }
    }
}

@Composable
private fun ChatsTab(api: ApiClient, onOpenThread: (Long, String) -> Unit) {
    var chats by remember { mutableStateOf<List<ChatSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            chats = api.listChats()
        } catch (e: Exception) {
            error = e.message
        }
    }
    when {
        error != null -> Text(error!!, modifier = Modifier.padding(16.dp))
        chats == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
        else ->
            LazyColumn {
                items(chats!!) { chat ->
                    ListItem(
                        headlineContent = { Text(chat.title.ifBlank { "chat ${chat.id}" }) },
                        supportingContent = { Text(chat.lastMessage?.content ?: "") },
                        modifier =
                            Modifier.testTag(TestTags.chatItem(chat.id)).clickable {
                                onOpenThread(chat.id, chat.title.ifBlank { "chat ${chat.id}" })
                            },
                    )
                }
            }
    }
}

@Composable
private fun MachinesTab(api: ApiClient, onOpenTerminal: (String, String) -> Unit) {
    var agents by remember { mutableStateOf<List<Agent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            agents = api.listAgents()
        } catch (e: Exception) {
            error = e.message
        }
    }
    when {
        error != null -> Text(error!!, modifier = Modifier.padding(16.dp))
        agents == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
        else ->
            LazyColumn {
                items(agents!!.filter { it.sid != null }) { agent ->
                    ListItem(
                        headlineContent = { Text(agent.nickname.ifBlank { "agent ${agent.userId}" }) },
                        supportingContent = { Text(if (agent.online) "online" else "offline") },
                        modifier =
                            Modifier.testTag(TestTags.agentItem(agent.userId)).clickable {
                                onOpenTerminal(
                                    agent.sid!!,
                                    agent.nickname.ifBlank { "agent ${agent.userId}" },
                                )
                            },
                    )
                }
            }
    }
}
