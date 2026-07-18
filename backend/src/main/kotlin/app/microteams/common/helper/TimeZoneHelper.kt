/*
 *  Description: This file provides helper functions for time zone conversion.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.common.helper

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

fun LocalDateTime.toEpochMilli(): Long =
    this.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

fun Long.toLocalDateTime(): LocalDateTime =
    LocalDateTime.ofInstant(Instant.ofEpochMilli(this), ZoneId.systemDefault())
