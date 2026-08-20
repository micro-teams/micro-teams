/*
 *  Description: This is the main class of the application.
 *               It is responsible for starting the Spring Boot application.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams

import app.microteams.transport.LineRegistryProperties
import org.rucca.cheese.common.config.ApplicationConfig
import org.slf4j.LoggerFactory
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication
import org.springframework.context.ApplicationListener
import org.springframework.context.annotation.Bean
import org.springframework.scheduling.annotation.EnableScheduling

// The borrowed authorization infrastructure and the leaf kernel it depends on
// (errors, config, IdType/BaseEntity) keep their original org.rucca.cheese packages,
// so they can one day be extracted independently; everything else lives under
// app.microteams. Component scan must therefore cover both roots.
//
// app.microteams.ops is deliberately EXCLUDED, and this exclusion is load-bearing rather than
// tidiness. The operator surface must exist only on the management port; anything Spring finds by
// component scan here is mounted on the PUBLIC application, and a Filter bean found here is applied
// to every public request. Those beans are declared instead by OpsManagementConfiguration, which
// Spring Boot loads into the management child context alone. If this exclusion is ever removed, the
// operator endpoints and their token check appear on the public port — quietly, and while every
// test still passes except the one written for exactly this (OpsSurfaceTest).
@SpringBootApplication(scanBasePackages = ["app.microteams", "org.rucca.cheese"], exclude = [])
@org.springframework.context.annotation.ComponentScan(
    basePackages = ["app.microteams", "org.rucca.cheese"],
    excludeFilters =
        [
            org.springframework.context.annotation.ComponentScan.Filter(
                type = org.springframework.context.annotation.FilterType.REGEX,
                pattern = ["app\\.microteams\\.ops\\..*"],
            )
        ],
)
@EnableConfigurationProperties(ApplicationConfig::class, LineRegistryProperties::class)
@EnableScheduling
class BackendApplication(private val applicationConfig: ApplicationConfig) {
    @Bean
    fun applicationReadyListener(): ApplicationListener<ApplicationReadyEvent> {
        return ApplicationListener { event ->
            if (applicationConfig.shutdownOnStartup) {
                LoggerFactory.getLogger(BackendApplication::class.java)
                    .info("Shutting down application as requested by configuration")
                SpringApplication.exit(event.applicationContext)
            }
        }
    }
}

fun main(args: Array<String>) {
    runApplication<BackendApplication>(*args)
}
