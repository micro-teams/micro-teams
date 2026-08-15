package app.microteams.model

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import io.swagger.v3.oas.annotations.media.Schema
import javax.validation.constraints.Size

/**
 * @param content
 * @param clientToken A caller-generated id for THIS message, so the send can be retried safely.
 *   Posting the same token again in the same thread does not create a second message: the one
 *   already stored is returned. A client that retries after a lost response needs this; one that
 *   never retries may omit it.
 */
data class PostMessageRequestDTO(
    @Schema(required = true, description = "")
    @param:JsonProperty("content")
    @get:JsonProperty("content", required = true)
    val content: kotlin.String,
    @get:Size(max = 64)
    @Schema(
        description =
            "A caller-generated id for THIS message, so the send can be retried safely. Posting the same token again in the same thread does not create a second message: the one already stored is returned. A client that retries after a lost response needs this; one that never retries may omit it. "
    )
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonSetter(nulls = Nulls.SKIP)
    @param:JsonProperty("clientToken")
    @get:JsonProperty("clientToken")
    val clientToken: kotlin.String? = null,
) {}
