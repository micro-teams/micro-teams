package app.microteams.model

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

/**
 * @param id Stable identifier for this path -- \"origin\", \"cf\", \"ipv6-1\".
 * @param url Absolute origin for this line, with no path and no trailing slash, or the empty string
 *   meaning \"wherever this page came from\". A single-origin deployment is one empty entry, and
 *   produces exactly the requests it produced before MultiPath existed.
 * @param transport Free-form label, for diagnosis only.
 * @param weight Static preference, higher first. Only breaks ties between lines that measure the
 *   same: a hand-set number goes stale and a measurement does not.
 * @param foreignOrigin True when this line is not under our own domain -- a free proxy that cannot
 *   be CNAME'd. It needs SameSite=None and explicit CORS, and is a fallback with reduced
 *   capability.
 */
data class LineDTO(
    @Schema(
        example = "null",
        required = true,
        description = "Stable identifier for this path -- \"origin\", \"cf\", \"ipv6-1\".",
    )
    @get:JsonProperty("id", required = true)
    val id: kotlin.String,
    @Schema(
        example = "null",
        required = true,
        description =
            "Absolute origin for this line, with no path and no trailing slash, or the empty string meaning \"wherever this page came from\". A single-origin deployment is one empty entry, and produces exactly the requests it produced before MultiPath existed. ",
    )
    @get:JsonProperty("url", required = true)
    val url: kotlin.String,
    @Schema(example = "null", description = "Free-form label, for diagnosis only.")
    @get:JsonProperty("transport")
    val transport: kotlin.String? = null,
    @Schema(
        example = "null",
        description =
            "Static preference, higher first. Only breaks ties between lines that measure the same: a hand-set number goes stale and a measurement does not. ",
    )
    @get:JsonProperty("weight")
    val weight: kotlin.Int? = null,
    @Schema(
        example = "null",
        description =
            "True when this line is not under our own domain -- a free proxy that cannot be CNAME'd. It needs SameSite=None and explicit CORS, and is a fallback with reduced capability. ",
    )
    @get:JsonProperty("foreignOrigin")
    val foreignOrigin: kotlin.Boolean? = null,
) {}
