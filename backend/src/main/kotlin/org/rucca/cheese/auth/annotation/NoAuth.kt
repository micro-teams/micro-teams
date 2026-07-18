/*
 *  Description: This file defines the NoAuth annotation.
 *               It is used to mark controller methods that do not need to be authenticated.
 *               This annotation should be used very carefully.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.annotation

@Target(AnnotationTarget.FUNCTION) @MustBeDocumented annotation class NoAuth()
