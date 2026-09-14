package app.microteams

import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory

/**
 * The one seam that differs per platform: which Ktor engine actually opens the socket. Everything
 * about talking to the server — paths, headers, the websocket protocol — is the same class
 * (ApiClient) on every target; only this factory changes underneath it, per the "one component,
 * platform decides the implementation" rule.
 */
expect fun httpEngine(): HttpClientEngineFactory<HttpClientEngineConfig>
