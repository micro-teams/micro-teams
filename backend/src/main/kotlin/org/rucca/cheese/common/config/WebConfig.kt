/*
 *  Description: This file defines the web configuration properties.
 *               It is used to config the web settings, especially the CORS settings.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.common.config

import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class WebConfig(private val applicationConfig: ApplicationConfig) : WebMvcConfigurer {
    override fun addCorsMappings(registry: CorsRegistry) {
        // allowedOriginPatterns (not allowedOrigins) so a wildcard/pattern can coexist with
        // allowCredentials(true) — needed when the app is reached through a dev tunnel or a
        // reverse proxy whose Origin isn't a fixed localhost. `application.cors-origin` may be
        // "*", a single origin, or a comma-separated list of origins/patterns.
        val patterns =
            applicationConfig.corsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        registry
            .addMapping("/**") // Allow all paths
            .allowedOriginPatterns(*patterns.toTypedArray())
            .allowedMethods("*") // Allow all methods
            .allowedHeaders("*") // Allow all headers
            .allowCredentials(true) // Allow credentials
            .maxAge(3600) // Set the max age to 1 hour
    }
}
