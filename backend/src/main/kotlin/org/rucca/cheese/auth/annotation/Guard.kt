/*
 *  Description: This file defines the Guard annotation.
 *               It is used to mark controller methods that need to be guarded.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.annotation

@Target(AnnotationTarget.FUNCTION)
@MustBeDocumented
annotation class Guard(val action: String, val resourceType: String)
