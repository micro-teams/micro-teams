/*
 *  Description: This file defines BaseError class and ErrorSerializer class.
 *               All http error classes should extend BaseError.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import com.fasterxml.jackson.core.JsonGenerator
import com.fasterxml.jackson.databind.JsonSerializer
import com.fasterxml.jackson.databind.SerializerProvider
import com.fasterxml.jackson.databind.annotation.JsonSerialize
import org.springframework.http.HttpStatus

private class ErrorSerializer : JsonSerializer<BaseError>() {
    override fun serialize(err: BaseError, gen: JsonGenerator, serializer: SerializerProvider) {
        val name = err::class.simpleName
        gen.writeStartObject()
        gen.writeNumberField("code", err.status.value())
        gen.writeStringField("message", "$name: ${err.message}")
        gen.writeFieldName("error")
        gen.writeStartObject()
        gen.writeStringField("name", name)
        gen.writeStringField("message", err.message)
        if (err.data != null) {
            gen.writeObjectField("data", err.data)
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
