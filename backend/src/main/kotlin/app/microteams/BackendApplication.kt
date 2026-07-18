/*
 *  Description: This is the main class of the application.
 *               It is responsible for starting the Spring Boot application.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams

import org.rucca.cheese.common.config.ApplicationConfig
import org.slf4j.LoggerFactory
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication
import org.springframework.context.ApplicationListener
import org.springframework.context.annotation.Bean

// The borrowed authorization infrastructure and the leaf kernel it depends on
// (errors, config, IdType/BaseEntity) keep their original org.rucca.cheese packages,
// so they can one day be extracted independently; everything else lives under
// app.microteams. Component scan must therefore cover both roots.
@SpringBootApplication(scanBasePackages = ["app.microteams", "org.rucca.cheese"])
@EnableConfigurationProperties(ApplicationConfig::class)
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
