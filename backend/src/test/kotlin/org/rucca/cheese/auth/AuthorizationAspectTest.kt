/*
 *  Description: Unit tests for the AuthorizationAspect class
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import com.ninjasquad.springmockk.SpykBean
import io.mockk.every
import io.mockk.verify
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test
import org.rucca.cheese.auth.exception.DuplicatedAuthInfoKeyException
import org.rucca.cheese.auth.exception.DuplicatedResourceIdAnnotationException
import org.rucca.cheese.auth.exception.NoGuardOrNoAuthAnnotationException
import org.rucca.cheese.auth.exception.ResourceIdTypeMismatchException
import org.rucca.cheese.common.error.GlobalErrorHandler
import org.rucca.cheese.common.error.InternalServerError
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders

@Disabled("Disabled to speed up tests")
@SpringBootTest
@AutoConfigureMockMvc
class AuthorizationAspectTest
@Autowired
constructor(
    private val mockMvc: MockMvc,
    @SpykBean private val authorizationService: AuthorizationService,
    @SpykBean private val globalErrorHandler: GlobalErrorHandler,
) {
    @BeforeEach
    fun prepare() {
        // Prevent the actual audit method from being called
        every { authorizationService.audit(String(), any(), String(), any()) }

        // Avoid error logging in the console
        every { globalErrorHandler.handleException(any()) } returns
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(InternalServerError())
    }

    @Test
    fun testNoGuardOrNoAuthAnnotationException() {
        mockMvc.perform(MockMvcRequestBuilders.get("/example/1"))
        verify { globalErrorHandler.handleException(ofType<NoGuardOrNoAuthAnnotationException>()) }
    }

    @Test
    fun testDuplicatedResourceIdAnnotationException() {
        mockMvc.perform(MockMvcRequestBuilders.get("/example/2?id1=1&id2=2"))
        verify {
            globalErrorHandler.handleException(ofType<DuplicatedResourceIdAnnotationException>())
        }
    }

    @Test
    fun testResourceIdTypeMismatchException() {
        mockMvc.perform(MockMvcRequestBuilders.get("/example/3?id=1"))
        verify { globalErrorHandler.handleException(ofType<ResourceIdTypeMismatchException>()) }
    }

    @Test
    fun testNoIdWithoutToken() {
        mockMvc.perform(MockMvcRequestBuilders.get("/example/4"))
        verify { authorizationService.audit(null, "query", "example", null) }
    }

    @Test
    fun testNoIdTokenInCapital() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example/4").header("Authorization", "Bearer token Xxx")
        )
        verify { authorizationService.audit("Bearer token Xxx", "query", "example", null) }
    }

    @Test
    fun testNoIdTokenNotInCapital() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example/4").header("Authorization", "Bearer token Xxx")
        )
        verify { authorizationService.audit("Bearer token Xxx", "query", "example", null) }
    }

    @Test
    fun testWithId() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example/5?id=123")
                .header("Authorization", "Bearer token Xxx")
        )
        verify { authorizationService.audit("Bearer token Xxx", "query", "example", 123) }
    }

    @Test
    fun testNoAuth() {
        mockMvc.perform(MockMvcRequestBuilders.get("/example/6"))
        verify(exactly = 0) { authorizationService.audit(String(), any(), String(), any()) }
    }

    @Test
    fun testMvcController() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example2/1?id=123")
                .header("Authorization", "Bearer token Xxx")
        )
        verify { authorizationService.audit("Bearer token Xxx", "query", "example", 123) }
    }

    @Test
    fun testWithIdAndAdditional() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example/7?id=123&additional_str=abc&additional_id=456")
                .header("Authorization", "Bearer token Xxx")
        )
        verify {
            authorizationService.audit(
                "Bearer token Xxx",
                "query",
                "example",
                123,
                mapOf("str" to "abc", "id" to 456.toLong()),
            )
        }
    }

    @Test
    fun testDuplicatedAuthInfo() {
        mockMvc.perform(
            MockMvcRequestBuilders.get("/example/8?additional_1=abc&additional_2=123")
                .header("Authorization", "Bearer token Xxx")
        )
        verify { globalErrorHandler.handleException(ofType<DuplicatedAuthInfoKeyException>()) }
    }
}
