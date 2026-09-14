package app.microteams

import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.js.Js

@Suppress("UNCHECKED_CAST")
actual fun httpEngine(): HttpClientEngineFactory<HttpClientEngineConfig> =
    Js as HttpClientEngineFactory<HttpClientEngineConfig>
