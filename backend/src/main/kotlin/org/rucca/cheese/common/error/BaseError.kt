/*
 *  Description: This file defines BaseError class and ErrorSerializer class.
 *               All http error classes should extend BaseError.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.springframework.http.HttpStatus
import tools.jackson.core.JsonGenerator
import tools.jackson.databind.SerializationContext
import tools.jackson.databind.ValueSerializer
import tools.jackson.databind.annotation.JsonSerialize

private class ErrorSerializer : ValueSerializer<BaseError>() {
    override fun serialize(err: BaseError, gen: JsonGenerator, serializer: SerializationContext) {
        val name = err::class.simpleName
        gen.writeStartObject()
        gen.writeNumberProperty("code", err.status.value())
        gen.writeStringProperty("message", "$name: ${err.message}")
        gen.writeName("error")
        gen.writeStartObject()
        gen.writeStringProperty("name", name)
        gen.writeStringProperty("message", err.message)
        if (err.data != null) {
            gen.writePOJOProperty("data", err.data)
        }
        gen.writeEndObject()
        gen.writeEndObject()
    }
}

@JsonSerialize(using = ErrorSerializer::class)
abstract class BaseError(
    val status: HttpStatus,
    override val message: String,
    val data: Any? = null,
) : Exception(message)
