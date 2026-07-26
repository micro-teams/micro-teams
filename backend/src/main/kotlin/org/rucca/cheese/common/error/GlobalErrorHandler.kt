/*
 *  Description: This file implements GlobalErrorHandler class.
 *               It handles all exceptions thrown by controllers.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import jakarta.servlet.http.HttpServletRequest
import org.rucca.cheese.auth.annotation.NoAuth
import org.rucca.cheese.auth.error.AuthenticationRequiredError
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageConversionException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.ResponseBody
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.resource.NoResourceFoundException

@ControllerAdvice
class GlobalErrorHandler {
    private val logger = LoggerFactory.getLogger(GlobalErrorHandler::class.java)

    @ExceptionHandler(BaseError::class)
    @ResponseBody
    fun handleBaseError(e: BaseError): ResponseEntity<BaseError> {
        return ResponseEntity.status(e.status).body(e)
    }

    @ExceptionHandler(AuthenticationRequiredError::class)
    @ResponseBody
    @NoAuth
    fun handleAuthenticationRequiredError(
        e: AuthenticationRequiredError,
        request: HttpServletRequest,
    ): ResponseEntity<*> {
        // 检查是否是 SSE 请求
        val acceptHeader = request.getHeader("Accept")
        if (acceptHeader?.contains("text/event-stream") == true) {
            // 手动构造 SSE 格式的错误响应
            val errorJson =
                """
                {
                    "code": ${e.status.value()},
                    "message": "${e.message}",
                    "error": {
                        "name": "${e::class.simpleName}",
                        "message": "${e.message}"
                    }
                }
            """
                    .trimIndent()

            val sseData = "data: $errorJson\n\n"

            return ResponseEntity.status(e.status)
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(sseData)
        }

        // 普通 JSON 响应
        return ResponseEntity.status(e.status).contentType(MediaType.APPLICATION_JSON).body(e)
    }

    @ExceptionHandler(MissingServletRequestParameterException::class)
    @ResponseBody
    fun handleMissingServletRequestParameterException(
        e: MissingServletRequestParameterException
    ): ResponseEntity<BaseError> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(BadRequestError(e.message))
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException::class)
    @ResponseBody
    fun handleMethodArgumentTypeMismatchException(
        e: MethodArgumentTypeMismatchException
    ): ResponseEntity<BaseError> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(BadRequestError(e.message ?: "Method argument type mismatch"))
    }

    @ExceptionHandler(HttpMessageConversionException::class)
    @ResponseBody
    fun handleHttpMessageConversionException(
        e: HttpMessageConversionException
    ): ResponseEntity<BaseError> {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(
                BadRequestError(e.message ?: "Invalid request caused http message conversion error")
            )
    }

    // A request that matches no controller route and no static resource is a 404 for the URL, not a
    // server fault. Spring surfaces it as NoResourceFoundException (static-resource fallback, the
    // default in Boot 3.2+) or NoHandlerFoundException; left to the catch-all below both would
    // become
    // a 500 with a full ERROR stacktrace — which floods the log with every bad URL, hides real
    // failures, and tells a caller who mistyped a path that the server crashed. Map them to a 404
    // NotFoundError contract instead, logged at DEBUG without a stacktrace.
    @ExceptionHandler(NoResourceFoundException::class)
    @ResponseBody
    fun handleNoResourceFound(e: NoResourceFoundException): ResponseEntity<BaseError> {
        logger.debug("No endpoint for {} {}", e.httpMethod, e.resourcePath)
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(EndpointNotFoundError(e.httpMethod.name(), "/${e.resourcePath}"))
    }

    @ExceptionHandler(NoHandlerFoundException::class)
    @ResponseBody
    fun handleNoHandlerFound(e: NoHandlerFoundException): ResponseEntity<BaseError> {
        logger.debug("No endpoint for {} {}", e.httpMethod, e.requestURL)
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(EndpointNotFoundError(e.httpMethod, e.requestURL))
    }

    @ExceptionHandler(Exception::class)
    @ResponseBody
    fun handleException(e: Exception): ResponseEntity<BaseError> {
        logger.error("Unexpected error", e)
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(InternalServerError())
    }
}
