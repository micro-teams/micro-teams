/*
 *  Description: This file defines the application configuration properties.
 *               It is used to read the properties from src/main/resources/application.properties
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "application")
class ApplicationConfig {
    lateinit var legacyUrl: String
    lateinit var jwtSecret: String
    lateinit var corsOrigin: String
    var shutdownOnStartup: Boolean = false
    var warnAuditFailure: Boolean = false
}
