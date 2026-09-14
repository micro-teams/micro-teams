package app.microteams

/**
 * Stable ids for the elements an e2e test drives, on every target. On wasmJs these become the id
 * of the accessibility DOM node Compose maintains over its canvas — see Modifier.testTag's use
 * sites — which is what app/e2e drives via Playwright; kept here as the one place a renamed
 * screen has to update both sides.
 */
object TestTags {
    const val LOGIN_SERVER_URL = "login-server-url"
    const val LOGIN_USERNAME = "login-username"
    const val LOGIN_PASSWORD = "login-password"
    const val LOGIN_SUBMIT = "login-submit"
    const val LOGIN_ERROR = "login-error"

    const val TAB_CHATS = "tab-chats"
    const val TAB_MACHINES = "tab-machines"

    fun chatItem(id: Long) = "chat-item-$id"

    fun agentItem(userId: Long) = "agent-item-$userId"

    const val THREAD_BACK = "thread-back"
    const val THREAD_INPUT = "thread-input"
    const val THREAD_SEND = "thread-send"

    fun threadMessage(id: Long) = "thread-message-$id"

    const val TERMINAL_BACK = "terminal-back"
    const val TERMINAL_OUTPUT = "terminal-output"
    const val TERMINAL_INPUT = "terminal-input"
    const val TERMINAL_SEND = "terminal-send"
}
