package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
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
        required = true,
        description = "Stable identifier for this path -- \"origin\", \"cf\", \"ipv6-1\".",
    )
    @param:JsonProperty("id")
    @get:JsonProperty("id", required = true)
    val id: kotlin.String,
    @Schema(
        required = true,
        description =
            "Absolute origin for this line, with no path and no trailing slash, or the empty string meaning \"wherever this page came from\". A single-origin deployment is one empty entry, and produces exactly the requests it produced before MultiPath existed. ",
    )
    @param:JsonProperty("url")
    @get:JsonProperty("url", required = true)
    val url: kotlin.String,
    @Schema(description = "Free-form label, for diagnosis only.")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("transport")
    @get:JsonProperty("transport")
    val transport: kotlin.String? = null,
    @Schema(
        description =
            "Static preference, higher first. Only breaks ties between lines that measure the same: a hand-set number goes stale and a measurement does not. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("weight")
    @get:JsonProperty("weight")
    val weight: kotlin.Int? = null,
    @Schema(
        description =
            "True when this line is not under our own domain -- a free proxy that cannot be CNAME'd. It needs SameSite=None and explicit CORS, and is a fallback with reduced capability. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("foreignOrigin")
    @get:JsonProperty("foreignOrigin")
    val foreignOrigin: kotlin.Boolean? = null,
) {}
