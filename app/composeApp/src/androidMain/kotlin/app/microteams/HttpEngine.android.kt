package app.microteams

import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.okhttp.OkHttp

@Suppress("UNCHECKED_CAST")
actual fun httpEngine(): HttpClientEngineFactory<HttpClientEngineConfig> =
    OkHttp as HttpClientEngineFactory<HttpClientEngineConfig>
