/*
 *  Description: This file defines the AuthInfo annotation.
 *               It is used to mark the parameter that is related to authorization.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.annotation

@Target(AnnotationTarget.VALUE_PARAMETER)
@MustBeDocumented
annotation class AuthInfo(val key: String)
