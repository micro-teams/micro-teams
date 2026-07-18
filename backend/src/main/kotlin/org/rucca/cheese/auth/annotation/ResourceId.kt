/*
 *  Description: This file defines the ResourceId annotation.
 *               It is used to mark the parameter that contains the resource id.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth.annotation

@Target(AnnotationTarget.VALUE_PARAMETER) @MustBeDocumented annotation class ResourceId()
