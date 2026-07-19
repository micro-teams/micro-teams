/*
 *  Description: The team document tree, served as an ordinary git remote over smart HTTP, so an
 *               agent (or a human) can clone / commit / push it with plain git. It is the very bare
 *               repo GitService already owns — here it is put on the wire at `<base>/git/{teamId}`.
 *
 *               Why a raw servlet + filter and not the OpenAPI controller: the git wire protocol is
 *               not a business DTO OpenAPI can describe — the same "genuinely not expressible as a
 *               REST operation" category as the connector's WebSocket endpoints, so like them it is
 *               registered by hand. Authorization is NOT bypassed: the filter resolves the caller's
 *               token to a user and asks the ordinary matrix — read-document to fetch, write-document
 *               to push, on team_document with the team id as the resource — the very rows that
 *               govern the human /team/{id}/document endpoints. A valid token is necessary but not
 *               sufficient; membership is.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 */

package app.microteams.team.documents

import jakarta.servlet.Filter
import jakarta.servlet.FilterChain
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletResponse
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.util.Base64
import org.eclipse.jgit.errors.RepositoryNotFoundException
import org.eclipse.jgit.http.server.GitServlet
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.storage.file.FileRepositoryBuilder
import org.eclipse.jgit.transport.ReceivePack
import org.eclipse.jgit.transport.UploadPack
import org.eclipse.jgit.transport.resolver.RepositoryResolver
import org.rucca.cheese.auth.AuthorizationService
import org.slf4j.LoggerFactory
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.boot.web.servlet.ServletRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered

/** The URL prefix the git remote lives under: `<base>/git/{teamId}`. */
private const val GIT_PREFIX = "/git"

@Configuration
class DocumentGitHttpConfig(
    private val gitService: GitService,
    private val authorizationService: AuthorizationService,
) {

    @Bean
    fun teamGitServlet(): ServletRegistrationBean<GitServlet> {
        val servlet = GitServlet()
        servlet.setRepositoryResolver(TeamRepositoryResolver(gitService))
        // Both directions are enabled unconditionally; whether THIS caller may fetch or push is
        // decided by DocumentGitAuthFilter before a request ever reaches the servlet.
        servlet.setUploadPackFactory { _, db -> UploadPack(db) }
        servlet.setReceivePackFactory { _, db -> ReceivePack(db) }
        val reg = ServletRegistrationBean(servlet, "$GIT_PREFIX/*")
        reg.setName("teamGitServlet")
        return reg
    }

    @Bean
    fun teamGitAuthFilter(): FilterRegistrationBean<DocumentGitAuthFilter> {
        val reg = FilterRegistrationBean(DocumentGitAuthFilter(authorizationService))
        reg.addUrlPatterns("$GIT_PREFIX/*")
        reg.order = Ordered.HIGHEST_PRECEDENCE
        return reg
    }
}

/** Opens a team's bare repo named by the `{teamId}` (or `{teamId}.git`) segment of the URL. */
class TeamRepositoryResolver(private val gitService: GitService) :
    RepositoryResolver<HttpServletRequest> {
    override fun open(req: HttpServletRequest, name: String): Repository {
        val teamId =
            name.removeSuffix(".git").toLongOrNull() ?: throw RepositoryNotFoundException(name)
        val dir = gitService.bareRepoDir(teamId)
        if (!dir.isDirectory) throw RepositoryNotFoundException(name)
        return FileRepositoryBuilder().setGitDir(dir).setMustExist(true).build()
    }
}

/**
 * Resolves the caller's token to a user and gates the git request on the document matrix: a push
 * (git-receive-pack) needs write-document, a fetch needs read-document, both on team_document with
 * the team id as the resource. No token, or one the matrix rejects, is answered with 401 so a git
 * credential helper is prompted rather than the request silently failing.
 */
class DocumentGitAuthFilter(private val authorizationService: AuthorizationService) : Filter {
    private val logger = LoggerFactory.getLogger(DocumentGitAuthFilter::class.java)

    override fun doFilter(request: ServletRequest, response: ServletResponse, chain: FilterChain) {
        val http = request as HttpServletRequest
        val resp = response as HttpServletResponse

        val teamId = teamIdOf(http.requestURI)
        if (teamId == null) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND)
            return
        }

        val auth =
            try {
                authorizationService.verify(bearerFrom(http.getHeader("Authorization")))
            } catch (e: Exception) {
                resp.setHeader("WWW-Authenticate", "Basic realm=\"microteams git\"")
                resp.sendError(HttpServletResponse.SC_UNAUTHORIZED)
                return
            }

        val action = if (isPush(http)) "write-document" else "read-document"
        if (!authorizationService.allows(auth, action, "team_document", teamId)) {
            logger.warn("git {} denied: user {} on team {}", action, auth.userId, teamId)
            resp.sendError(HttpServletResponse.SC_FORBIDDEN)
            return
        }
        chain.doFilter(request, response)
    }

    /** `/git/{teamId}/...` (or `{teamId}.git`) -> teamId, or null if the shape is wrong. */
    private fun teamIdOf(uri: String): Long? {
        val rest = uri.removePrefix(GIT_PREFIX).trimStart('/')
        return rest.substringBefore('/').removeSuffix(".git").toLongOrNull()
    }

    /**
     * A push is git-receive-pack: advertised on info/refs `?service=`, then posted to that path.
     */
    private fun isPush(http: HttpServletRequest): Boolean =
        http.getParameter("service") == "git-receive-pack" ||
            http.requestURI.endsWith("/git-receive-pack")

    /**
     * Accept `Bearer <jwt>`, a raw jwt, or Basic where the password is the jwt (git credential).
     */
    private fun bearerFrom(header: String?): String? {
        if (header == null) return null
        if (header.startsWith("Basic ", ignoreCase = true)) {
            return try {
                val decoded = String(Base64.getDecoder().decode(header.substring(6).trim()))
                decoded.substringAfter(':', "").ifBlank { null }
            } catch (e: IllegalArgumentException) {
                null
            }
        }
        return header
    }
}
