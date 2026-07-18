/*
 *  Description: This file defines InternalServerError class.
 *               It is thrown when GlobalErrorHandler catches an exception that
 *               does not extend BaseError.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.error

import org.springframework.http.HttpStatus

class InternalServerError :
    BaseError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "The server encountered an unexpected error. Please try again later.",
    )
