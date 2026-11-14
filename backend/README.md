# backend (`mt`)

The MicroTeams backend: teams, documents, chat, machines and agents. Kotlin / Spring Boot 4 /
Java 21 / Maven, served under `/mt` behind the deployment's nginx.

Many conventions below are not the most common Spring practice. They are what this backend does,
and they are followed for consistency.

Cardinal rule: **if the integration tests are green, the covered code is correct.** Debugging is
done with tests, not by starting the jar and calling it with curl. See _Testing_.

---

## 1. OpenAPI-first codegen

- Change `MicroTeams-API.yml` **first**; the build then regenerates the API interfaces
  (`app.microteams.api.*Api`) and DTOs (`app.microteams.model.*DTO`). **Never hand-write
  or hand-edit generated interfaces / DTOs.**
- The generator writes **into `src/main/kotlin/.../api` and `.../model`** (not `target/`) and
  **does not delete stale files**. When a path or schema leaves the YAML, `rm` the orphaned
  generated `.kt` file(s) by hand.
- Same trap one level down: `target/classes` keeps `.class` files for sources that were moved or
  deleted, and the compiler resolves against them. A moved package then produces impossible
  errors such as "actual type is `team.membership.TeamMemberRole` but `team.TeamMemberRole` was
  expected", and a deleted test class keeps running. **After moving, renaming or deleting
  anything, run `./mvnw clean`.**
- Controllers implement the generated `XxxApi` interface. Match the generated method
  signature exactly (the compiler reports drift — e.g. `pageSize: Int`, not `Int?`, when the
  param has a default).
- **One module = one path prefix = one controller.** A module's package name is the singular
  first path segment (`/chat` → `chat/ChatController`, `/team` → `team/TeamController`), and
  that controller's methods are **only** implementations of its generated `XxxApi`. The
  generator derives the Api class from the **first path segment, not the tag**, so the path
  drives everything: an operation under `/team/...` lands in `TeamApi`.
- A module may split its *implementation* into subpackages by feature — `team/membership`
  (team + members) and `team/documents` (the git tree) each own their entities and services —
  but the single controller of the module stays its only entry point.
- Hand-written `@RestController`s are **not** an escape hatch: everything expressible as HTTP
  goes in the YAML. The only things registered outside it are what OpenAPI cannot describe —
  the WebSocket endpoints (as handlers, not controllers), `AgentAppletController`, which serves
  a JavaScript asset (`GET /agent/cli-applet`, the CLI applet) rather than a business DTO, and
  `connector/ConnectorController`, which serves the installer and binaries at the origin root.

## 2. Module layout — the map

```
chat/       ChatController       thread/ message/            (+ WebSocketConfig: STOMP /mt/ws)
team/       TeamController       membership/ documents/ machine/
machine/    MachineController    enrollment/ link/ screen/   (+ MachineWebSocketConfig: raw WS)
agent/      AgentController      screen/ driver/             (+ AgentAppletController, see §1)
updates/    UpdatesWebSocketConfig   synced queries pushed to clients (map/ holds one file per topic)
transport/  TransportController  the line registry (/lines) and /probe
connector/  ConnectorController  install.sh and the connector binaries, at the origin root
ops/        the operator surface, on the management port only
user/       read-only mirrors of cheese-auth's tables + RolePermissionService (§5)
ping/       the minimal authenticated endpoint
common/     BaseEntity, PageHelper, errors
org/rucca/cheese/   the authorization framework: JWT, the @Guard aspect, custom-logic expressions
```

Why the machine/agent split has three layers:

- **`machine/` knows nothing about agents.** It is a host running our CLI: a control channel
  (`link/`, the frozen `link.Msg` protocol + `MachineHub`) and screens (`screen/` — a hosted
  process, its terminal, an optional applet). A screen is **not** an agent: it carries an
  opaque `kind`, not a user id, so a shared shell or a vscode-server is expressible with no
  agent involved. Never reach from here into chat or agent — publish an event instead
  (`MachineForgottenEvent`) and let the owner clean up.
- **`team/machine/` owns *whose* a machine is.** `mayAccess(userId, machineId)` is the single
  access question the rest of the backend asks about a machine.
- **`agent/` is one application that runs on a machine.** `Agent` is deliberately tiny and
  mentions no machine/screen/driver — a server-side agent must be able to implement it.
  `agent/screen/ScreenAgent` is the implementation in use; `agent/driver/` is the only place
  that knows which coding agent runs (an `AgentDriver` is exactly: the argv, and the applet).
  A new coding agent is one new `AgentDriver`, nothing else.
- **Chat reaches an agent by callback, not lookup.** An agent registers itself as a
  `ChatSubscriber` (`chat/ChatSubscriptions`); chat answers "who is in this thread, who wrote
  this" and calls back. **Chat never imports agent**, so group-membership semantics stay inside
  chat.

**`updates/` listens; nobody calls it.** Each topic in `updates/map/` subscribes to events the
owning module already publishes. No business method notifies the push layer, so a feature never
has to remember to.

Dependency direction is the invariant. It stays exactly:
`chat → (nothing)`, `team/machine → team`, `machine → team`, `agent → machine, chat, team`,
`updates → chat, team, machine, agent`.

## 3. Entities & persistence

- **Class name has no `Entity` suffix**: file `TeamEntity.kt` defines `class Team`; the
  repository interface lives **in the same file**.
- Extend `BaseEntity` — it provides `id` (SEQUENCE), `createdAt`, `updatedAt`, `deletedAt`.
  Use `IdType` (= `Long`) in signatures, not raw `Long`.
- Soft delete: put `@SQLRestriction("deleted_at IS NULL")` on the entity. Repo methods then
  **must NOT** carry `...AndDeletedAtIsNull` suffixes — the restriction filters globally.
  Single lookups return `Optional<>`.
- Fields are nullable-with-default even for NOT NULL columns (`var name: String? = null`),
  the JPA-no-arg way; assert `!!` in mappers — **except timestamps**: `@CreationTimestamp`
  populates only on flush, so a just-`save()`d entity has a **null `createdAt` in memory**. Map
  it null-safely (`createdAt?.atOffset(...)`) and keep the DTO field optional; a `!!` there, or a
  `required: [createdAt]` in the YAML, 500s every create with an NPE.
- **Entities must be `open`, and that comes from the compiler plugins.** The
  `<compilerPlugins>` in `pom.xml` must be `spring` + `jpa` + **`all-open` with the JPA
  annotations**:

  ```xml
  <compilerPlugins><plugin>spring</plugin><plugin>jpa</plugin><plugin>all-open</plugin></compilerPlugins>
  <pluginOptions>
    <option>all-open:annotation=jakarta.persistence.Entity</option>
    <option>all-open:annotation=jakarta.persistence.MappedSuperclass</option>
    <option>all-open:annotation=jakarta.persistence.Embeddable</option>
  </pluginOptions>
  ```

  Why each is load-bearing: `spring` opens `@Component`/`@Transactional`, `jpa` **only adds a
  no-arg constructor** — *neither opens `@Entity`*. A Kotlin class and its `val` getters are final
  by default, and Hibernate builds a runtime **proxy subclass** for any entity reached through a
  lazy to-one (here `User`/`Avatar`, via `UserProfile`'s `@ManyToOne(LAZY)`). A proxy cannot
  override a final getter, so a final `BaseEntity.getCreatedAt` makes the **whole SessionFactory
  fail to build** — `Getter methods of lazy classes cannot be final` — and *every* DB test 500s
  at once. To check: `javap` an entity — `public final class Team` means all-open is off; it must
  read `public class Team`. An entity is never a `data class` for the same reason. Do **not** work
  around this by hand-`open`ing BaseEntity — fix the plugin, so every entity is covered.
- **Enums are stored as strings**: `@Enumerated(EnumType.STRING)` + a DB `CHECK` constraint.
  Never omit it — the JPA default is ORDINAL (`0/1/2`), which violates the string CHECK and
  500s on the first insert. A "kind"/"type" column is a string enum too — no raw `integer` or
  free string.
- **Schemas — `microteams` vs `public`**: our own tables live in `microteams`
  (`spring.jpa.properties.hibernate.default_schema=microteams`). The three tables shared with
  cheese-auth (`User`, `UserProfile`, `Avatar`) are pinned to `public` and treated as
  read-only in prod. A shared entity needs **both** `@Table(schema = "public")` **and**
  `@SequenceGenerator(schema = "public", ...)` — the sequence does **not** inherit the
  table's schema, and without it Hibernate looks for `microteams.user_id_seq`.

## 4. Service / controller / DTO

- **Services return DTOs; controllers are thin.** Do not map entities→DTOs inside controllers.
- DTO mapping is a **top-level extension function in the service file**:
  `fun Team.toTeamDTO() = TeamDTO(...)`. Enum conversions: `fun TeamMemberRole.convert() = ...`.
- **Auth registration goes in the controller's `@PostConstruct`** (`ownerIds.register(...)` +
  `customAuthLogics.register(...)`), not a separate initializer bean.
- **Errors: throw `BaseError` subclasses** (`NotFoundError(type, id)`, `BadRequestError(msg)`).
  The global handler maps `BaseError` → its status; **everything else → 500**. Do **not** use
  `@ResponseStatus` on a plain exception (the catch-all `@ExceptionHandler(Exception)`
  intercepts first and it becomes 500). A git-layer not-found therefore extends
  `BaseError(NOT_FOUND, ...)`.
- **Success responses are raw DTOs** (no `{data}` envelope). Errors serialize as
  `{code, message, error}` via `BaseError`.
- Every Kotlin file starts with the `/* Description: ... Author(s): ... */` header block, which
  follows the file-header rule in the repository's `AGENTS.md`.
- Formatting is enforced by spotless (ktfmt); the build applies it.

## 5. Authorization — all of it, in one table

**`RolePermissionService` is the entire business authorization model, and that claim is only true
if two rules hold absolutely. Both are easy to break by accident and neither is checked by the
compiler.**

1. **Business code has no authorization.** No service throws `ForbiddenError`; no service asks
   "may this user…". If a rule is not visible in the table, it does not exist.
2. **Authorization code has no business logic.** Each clause is one atomic named predicate that
   turns `(userId, authInfo)` into a single true/false fact, registered in the `@PostConstruct`
   of the controller that owns the concept.

The payoff: an auditor reads one file and sees every endpoint's rule.

- Guard every controller method with `@Guard(action, resourceType)`, annotate the id path param
  with `@ResourceId`, and pass anything else a predicate needs with `@AuthInfo("key")` — that is
  how a rule can depend on the *request*, including query filters (`is-enumerating-own-machines`
  reads `authInfo["teamId"] == null`).
- **Actions are named after the endpoint** (`rename-machine`, `dissolve-chat`, `post-message`,
  `watch`), never CRUD verbs. A row then reads as one endpoint's permission, and one permission
  cannot accidentally satisfy another: a `read` shared between `listTeams` and `getTeam` would
  let a stranger read any team.
- **`customLogic` is a boolean expression, not a name** — `&&`, `||`, `!`, parens, parsed by
  `CustomAuthLogics`:
  `"can-access-screen-machine || shares-group-with-screen-agent"`. Do not spread one rule over
  several permissions to fake an OR.
- Ids that are **strings** (machine ids, screen sids) cannot ride in `resourceId` (it is
  `IdType`); pass them via `@AuthInfo` and read them from `authInfo`.
- The built-in **`owned`** predicate resolves ownership via the `ownerIds` provider — **the
  `ownerIds` resourceType must exactly match the `@Guard` resourceType.** Registering the thread
  owner under `"thread"` while guarding `"chat_thread"` silently 403s the owner.
- `audit()` throws; **`allows()`** answers. Use `allows()` to *filter* by permission
  (`listAgents` attaches a screen id only to agents the caller may watch) instead of
  try/catching a throw.
- Callers without a JWT still go through the matrix: the agent tool-door resolves a machine +
  screen token to an agent user (that is *authentication*), then asks the matrix as that user — so
  an agent obeys the same `is-thread-member` row as a human.
- Resource types stay module-prefixed: `team`, `team_document`, `chat_thread`, `chat_message`,
  `machine`, `machine_screen`, `agent`.
- Because the matrix answers before the handler runs, an unknown resource is **403, not 404**.
  That is intentional (no existence oracle).

## 6. Pagination — `PageHelper` / `PageDTO`

- Do **not** write a pager. Use `common/helper/PageHelper` and the generated `PageDTO`
  (schema `Page` in the YAML).
- Cursor pagination: query params **`page_start`** (id of the first item) + **`page_size`**
  (default 20), everywhere.
- List endpoints return a **`{items, page}` wrapper** (`ListTeamsResponse`, `ListChatsResponse`,
  `ListMessagesResponse`, `ListMachinesResponse`, `ListAgentsResponse`), not a bare array.
- **One enumeration per thing, narrowed by composable query filters** — never a second endpoint
  for a second way to slice. `GET /agent?userId=…&threadId=…&online=…` is the one way to ask
  about agents, presence included.
- `PageHelper.pageFromAll(all, pageStart, pageSize, { it.id!! }, null)` is the
  load-all-then-slice variant — fine at our scale.

## 7. Documents = git, no DB table

- There is **no document table**. Each team owns a bare git repo at
  `${application.git-repo-base}/{teamId}.git` (`GitService`).
- Documents are a **feature of the team module**, not a module of their own: the API is
  `/team/{id}/document` (so it generates into `TeamApi` and is served by `TeamController`),
  and the implementation lives in `team/documents/`. The same repos are also served over git's
  smart HTTP protocol, which is how an agent's `docs sync` clones and pushes.
- Prefer **one consolidated endpoint with query flags** over many endpoints.
  `/team/{id}/document` GET serves root/tree/file/history/diff via `path` / `recursive` /
  `content` / `history` / `diff`; PUT/PATCH/DELETE do write/move/delete. A new view is a new
  flag, not a new endpoint.
- **Reads pull blobs straight from the bare repo** (no clone). **Writes** clone a throwaway
  worktree, commit, push back.
- Paths are **logical git paths**: repo-relative, `/`-separated, no leading `/`, no `..`.
  Validate at the controller (→ 400 `BadRequestError`) and again in `GitService` (defense in
  depth). Reads are traversal-safe because they use the git object model.

## 8. Testing — integration only

- **No mock-based unit tests.** Stubbing repositories proves nothing; it only produces fake
  coverage.
- Write **integration tests**: `@SpringBootTest @AutoConfigureMockMvc
  @TestInstance(PER_CLASS) @TestMethodOrder(OrderAnnotation)`, constructor-inject `MockMvc` +
  `UserCreatorService`, `@BeforeAll` creates real users and logs in **through the real
  cheese-auth service**, ordered tests share state, assert with `jsonPath`. See
  `src/test/kotlin/app/microteams/api/`.
- **Depending on external services (Postgres, cheese-auth) is the point of integration
  testing, not a smell.** `UserCreatorService` inserts a real user row and logs in via
  `application.legacy-url`.
- `GitServiceTest` is the one "unit-ish" test — it uses **real JGit** on temp dirs, no mocks,
  so it is integration-style already.
- `AgentLoopTest` proves the whole agent loop without a real coding agent: a fake machine (a real
  WebSocket client) enrolls, a human opens an agent on it, a chat message must arrive as a `say`,
  and the "agent" exchanges its machine+screen tokens for its user token (`POST /agent/token`) and
  answers through the tool-door as an ordinary Bearer caller — proving "an agent is a user". It also
  asserts `GET /agent/cli-applet` serves the CLI applet (the JS that defines `microteams api`), so a
  missing or empty applet — a live agent with no tools — fails a test instead of only surfacing in
  prod.
- Every new endpoint, behavior and bug fix gets an integration assertion. These tests catch what
  mocks never would: auth bypasses between enumerate and read, a missing `@Enumerated`, the
  404/400-vs-500 error contract, an `owned` resourceType mismatch.
- Tests are **hermetic**: inject config via `SPRING_APPLICATION_JSON`, and point
  `application.git-repo-base` at a fresh temp dir per run (`mktemp -d`) so git state never
  leaks across runs.

Run them (needs Postgres:5433 + cheese-auth:8091 up):

```bash
REPO_BASE=$(mktemp -d)
export SPRING_APPLICATION_JSON='{
  "spring.datasource.url":"jdbc:postgresql://localhost:5433/mydb",
  "spring.datasource.username":"username",
  "spring.datasource.password":"<db-pw>",
  "spring.jpa.hibernate.ddl-auto":"update",
  "application.jwt-secret":"<shared-with-cheese-auth>",
  "application.legacy-url":"http://localhost:8091",
  "application.git-repo-base":"'"$REPO_BASE"'"
}'
./mvnw test
```

## 9. Schema changes → drop the test DB

- `ddl-auto=update` **never drops** columns or constraints, so a stale test DB drifts from the
  entities and hides or creates bugs. After changing any entity, reset:
  `DROP SCHEMA microteams CASCADE; CREATE SCHEMA microteams;` and let Hibernate recreate it.
- Documents live on disk keyed by team id, which **resets when the DB is dropped** — so also use
  a fresh `application.git-repo-base` (the tests do, via `mktemp -d`). Otherwise a new team
  reuses an old id whose git repo still exists and inherits stale files.

## 10. Secrets & runtime config

- `application.properties` holds **only generic local-dev/CI defaults**. Real values — DB
  password, the jwt-secret that must match cheese-auth, `application.legacy-url` — are injected
  at runtime via CLI `--spring.*` args or `SPRING_APPLICATION_JSON`. **Never commit real
  secrets.**
- Building the jar (`mvnw install`) runs an antrun step that boots the app to regenerate
  `CREATE.sql` (backend root), so it needs a reachable DB.
- **Exactly one backend instance per deployment.** Machine links, screens and agents are held in
  this process's memory, so a second instance would split them. `deploy/docker-compose.yml`
  carries the same warning, because that is where a replica would be added.

## 11. Dependencies — a multi-artifact library moves as one version

Dependabot can bump a **single** artifact of a multi-jar library and skew it against its
siblings. A `jersey-media-multipart` one major version ahead of `jersey-client` / `jersey-hk2` /
`jersey-media-json-jackson` drags in a newer `jersey-common`, whose classes the older client lacks,
and every request dies with `NoClassDefFoundError`. Keep all of a library's artifacts on **one**
version, and treat a dependabot PR that touches only one of them with suspicion.

This trap and the all-open one (§3) are both latent: only a test that boots the full context with
the lazy `UserProfile` graph exercises them. A green `-DskipTests` build proves nothing about
either.
