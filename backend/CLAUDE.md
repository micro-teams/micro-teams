# Backend conventions (microteams-backend-mt lineage)

This backend is forked from **microteams-backend-mt** (Kotlin / Spring Boot 3.4 / Java 21 /
Maven). Many conventions below are *not* the most "standard" Spring practice — they are
what mt does and what fits our setup. **Follow them for consistency**; the reference repo
lives at `~/work/ref-study/microteams-backend-mt`.

Cardinal rule: **if the integration tests are green, the covered code is correct.** We do
not debug by "start the jar and curl". See _Testing_.

---

## 1. OpenAPI-first codegen

- Change `MicroTeams-API.yml` **first**, then build regenerates the API interfaces
  (`org.rucca.cheese.api.*Api`) and DTOs (`org.rucca.cheese.model.*DTO`). **Never hand-write
  or hand-edit generated interfaces / DTOs.**
- The generator writes **into `src/main/kotlin/.../api` and `.../model`** (not `target/`) and
  **does not delete stale files**. When you remove a path/schema from the YAML, manually
  `rm` the orphaned generated `.kt` file(s).
- Same trap one level down: `target/classes` keeps `.class` files for sources you moved or
  deleted, and the compiler happily resolves against them — a moved package produces
  impossible errors like "actual type is `team.membership.TeamMemberRole` but
  `team.TeamMemberRole` was expected". **After moving/renaming/deleting anything, `./mvnw
  clean`.** (This has bitten us twice: once here, once as a stale `TeamServiceTest.class`
  failing tests whose source no longer existed.)
- Controllers implement the generated `XxxApi` interface. Match the generated method
  signature exactly (compile tells you if it drifted — e.g. `pageSize: Int` not `Int?` when
  the param has a default).
- **One module = one path prefix = one controller.** A module's package name is the singular
  first path segment (`/chat` → `chat/ChatController`, `/team` → `team/TeamController`), and
  that controller's methods are **only** implementations of its generated `XxxApi` — nothing
  else. The generator derives the Api class from the **first path segment, not the tag**, so
  the path drives everything: put an operation under `/team/...` and it lands in `TeamApi`.
- A module may split its *implementation* into subpackages by feature — `team/membership`
  (team + members) and `team/documents` (the git tree) each own their entities and services —
  but the single `TeamController` in `team/` stays the only entry point.
- Hand-written `@RestController`s are **not** an accepted escape hatch: everything expressible
  as HTTP goes in the YAML. Only what OpenAPI genuinely cannot describe (the connector's
  WebSocket endpoints) is registered outside it, and as handlers, not controllers.

## 2. Module layout — the map

```
chat/      ChatController        thread/ message/            (+ WebSocketConfig: STOMP /mt/ws)
team/      TeamController        membership/ documents/ machine/
machine/   MachineController     enrollment/ link/ screen/   (+ MachineWebSocketConfig: raw WS)
agent/     AgentController       screen/ driver/             (+ AgentOpenApiController, see §1)
```

The three layers that used to be one `connector` module, and why they are three:

- **`machine/` knows nothing about agents.** It is a host running our CLI: a control channel
  (`link/`, the frozen `link.Msg` protocol + `MachineHub`) and screens (`screen/` — a hosted
  process, its terminal, an optional applet). A screen is **not** an agent: it carries an
  opaque `kind`, not a user id, so a future shared shell or vscode-server is expressible with
  no agent involved. Never reach from here into chat or agent — publish an event instead
  (`MachineForgottenEvent`) and let the owner clean up.
- **`team/machine/` owns *whose* a machine is.** `mayAccess(userId, machineId)` is the single
  access question the rest of the backend asks about a machine.
- **`agent/` is one application that runs on a machine.** `Agent` is deliberately tiny and
  mentions no machine/screen/driver — a server-side agent must be able to implement it.
  `agent/screen/ScreenAgent` is the implementation we happen to have; `agent/driver/` is the
  only place that knows Claude exists (an `AgentDriver` is exactly: the argv, and the applet).
  Swapping in Codex means one new `AgentDriver`, nothing else.
- **Chat reaches an agent by callback, not lookup.** An agent registers as a `ChatSubscriber`
  (`chat/ChatSubscriptions`) as itself; chat answers "who is in this thread, who wrote this" and
  calls back. **Chat must never import agent.** The orchestrator used to reach into
  `ThreadMemberRepository` itself, which leaked group-membership semantics out of chat.

Dependency direction is the invariant. It should stay exactly:
`chat → (nothing)`, `team/machine → team`, `machine → team`, `agent → machine, chat, team`.

## 3. Entities & persistence

- **Class name has no `Entity` suffix**: file `TeamEntity.kt` defines `class Team`; the
  repository interface lives **in the same file**. (mt style.)
- Extend `BaseEntity` — it provides `id` (SEQUENCE), `createdAt`, `updatedAt`, `deletedAt`.
  Use `IdType` (= `Long`) in signatures, not raw `Long`.
- Soft delete: put `@SQLRestriction("deleted_at IS NULL")` on the entity. Then repo methods
  **must NOT** carry `...AndDeletedAtIsNull` suffixes — the restriction filters globally.
  Single lookups return `Optional<>`.
- Fields are nullable-with-default even for NOT NULL columns (`var name: String? = null`),
  the JPA-no-arg way; assert `!!` in mappers — **except timestamps**: `@CreationTimestamp`
  populates only on flush, so a just-`save()`d entity has a **null `createdAt` in memory**. Map
  it null-safely (`createdAt?.atOffset(...)`) and keep the DTO field optional; a `!!` there, or a
  `required: [createdAt]` in the YAML, 500s every create with an NPE.
- **Entities must be `open`, and that comes from the compiler plugins — get it right or nothing
  DB-touching works.** The `<compilerPlugins>` in `pom.xml` must be `spring` + `jpa` + **`all-open`
  with the JPA annotations**:

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
  at once. Symptom to recognise: `javap` an entity — `public final class Team` means all-open is
  off; it must read `public class Team`. (Same reason an entity must never be a `data class`:
  those are final too.) Do **not** work around this by hand-`open`ing BaseEntity — fix the plugin,
  so every entity is covered.
- **Enums are stored as strings**: `@Enumerated(EnumType.STRING)` + a DB `CHECK` constraint.
  Never omit it — the JPA default is ORDINAL (`0/1/2`), which violates the string CHECK and
  500s on the first insert. (This bit us.) If you reintroduce a "kind"/"type" column, make
  it a string enum too — no raw `integer` / free-string.
- **Schemas — `microteams` vs `public`**: our own tables live in `microteams`
  (`spring.jpa.properties.hibernate.default_schema=microteams`). The three tables shared with
  cheese-auth (`User`, `UserProfile`, `Avatar`) are pinned to `public` and treated as
  read-only in prod. A shared entity needs **both** `@Table(schema = "public")` **and**
  `@SequenceGenerator(schema = "public", ...)` — the sequence does **not** inherit the
  table's schema, and forgetting it makes Hibernate look for `microteams.user_id_seq`.

## 4. Service / controller / DTO

- **Services return DTOs; controllers are thin.** Do not map entities→DTOs inside controllers.
- DTO mapping is a **top-level extension function in the service file**:
  `fun Team.toTeamDTO() = TeamDTO(...)`. Enum conversions: `fun TeamMemberRole.convert() = ...`.
- **Auth registration goes in the controller's `@PostConstruct`** (`ownerIds.register(...)` +
  `customAuthLogics.register(...)`), not a separate initializer bean.
- **Errors: throw `BaseError` subclasses** (`NotFoundError(type, id)`, `BadRequestError(msg)`).
  The global handler maps `BaseError` → its status; **everything else → 500**. Do **not** use
  `@ResponseStatus` on a plain exception (the catch-all `@ExceptionHandler(Exception)`
  intercepts first and it becomes 500). A git-layer not-found should therefore extend
  `BaseError(NOT_FOUND, ...)`.
- **Success responses are raw DTOs** (no `{data}` envelope). Errors serialize as
  `{code, message, error}` via `BaseError`.
- Every Kotlin file starts with the `/* Description: ... Author(s): ... */` header block.
- Code and comments are **English only**. Formatting is enforced by spotless (ktfmt); the
  build applies it.

## 5. Authorization — all of it, in one table

**RolePermissionService is the entire business authorization model, and that claim is only true
if two rules hold absolutely. Both are easy to break by accident and neither is checked by the
compiler.**

1. **Business code has no authorization.** No service throws `ForbiddenError`; no service asks
   "may this user…". If a rule is not visible in the table, it does not exist. (We had the
   opposite — `MachineService.requireAccess()` — and the table's own comment admitted "the real
   check is enforced in MachineService", i.e. the table was lying to its reader.)
2. **Authorization code has no business logic.** Each clause is one atomic named predicate that
   turns `(userId, authInfo)` into a single true/false fact, registered in the `@PostConstruct`
   of the controller that owns the concept.

The payoff: an auditor reads one file and sees every endpoint's rule.

- Guard every controller method with `@Guard(action, resourceType)`, annotate the id path param
  with `@ResourceId`, and pass anything else a predicate needs with `@AuthInfo("key")` — that is
  how a rule can depend on the *request*, including query filters (`is-enumerating-own-machines`
  reads `authInfo["teamId"] == null`).
- **Actions are named after the endpoint** (`rename-machine`, `dissolve-chat`, `post-message`,
  `watch`), never CRUD verbs. A row then reads as one endpoint's permission. Distinct actions
  also stop one permission from accidentally satisfying another: sharing `read` between
  `listTeams` and `getTeam` once let a stranger read any team.
- **`customLogic` is a boolean expression, not a name** — `&&`, `||`, `!`, parens, parsed by
  `CustomAuthLogics`. Use it:
  `"can-access-screen-machine || shares-group-with-screen-agent"`. Do not spread one rule over
  several permissions to fake an OR.
- Ids that are **strings** (machine ids, screen sids) cannot ride in `resourceId` (it is
  `IdType`); pass them via `@AuthInfo` and read them from `authInfo`.
- The built-in **`owned`** predicate resolves ownership via the `ownerIds` provider — **the
  `ownerIds` resourceType must exactly match the `@Guard` resourceType.** Registering the thread
  owner under `"thread"` while guarding `"chat_thread"` silently 403'd the owner.
- `audit()` throws; **`allows()`** answers. Use `allows()` to *filter* by permission
  (`listAgents` attaches a screen id only to agents the caller may watch) instead of
  try/catching a throw.
- Not-a-JWT callers still go through the matrix: the agent tool-door resolves machine+screen
  token to an agent user (that is *authentication*), then asks the matrix as that user — so an
  agent obeys the same `is-thread-member` row as a human.
- Resource types stay module-prefixed: `team`, `team_document`, `chat_thread`, `chat_message`,
  `machine`, `machine_screen`, `agent`.
- Consequence worth knowing: because the matrix answers before the handler runs, an unknown
  resource is **403, not 404**. That is intentional (no existence oracle).

## 6. Pagination — reuse mt's `PageHelper` / `PageDTO`

- Do **not** write your own pager. Use `common/helper/PageHelper` and the generated `PageDTO`
  (schema `Page` in the YAML).
- Cursor pagination: query params **`page_start`** (id of the first item) + **`page_size`**
  (default 20). Standardize on these names (we migrated chat's old `after` to them).
- List endpoints return a **`{items, page}` wrapper** (`ListTeamsResponse`, `ListChatsResponse`,
  `ListMessagesResponse`, `ListMachinesResponse`, `ListAgentsResponse`), not a bare array.
- **One enumeration per thing, narrowed by composable query filters** — never a second endpoint
  for a second way to slice. `GET /agent?userId=…&threadId=…&online=…` replaced both a
  `POST /connector/presence` (a POST that was really a query) and a per-thread presence route.
- `PageHelper.pageFromAll(all, pageStart, pageSize, { it.id!! }, null)` is the
  load-all-then-slice variant — fine for our scale.

## 7. Documents = git, no DB table

- There is **no document table**. Each team owns a bare git repo at
  `${application.git-repo-base}/{teamId}.git` (`GitService`).
- Documents are a **feature of the team module**, not a module of their own: the API is
  `/team/{id}/document` (so it generates into `TeamApi` and is served by `TeamController`),
  and the implementation lives in `team/documents/`.
- Prefer **one consolidated endpoint with query flags** over many endpoints.
  `/team/{id}/document` GET serves root/tree/file/history/diff via `path` / `recursive` /
  `content` / `history` / `diff`; PUT/PATCH/DELETE do write/move/delete. Future views = new
  flags, not new endpoints.
- **Reads pull blobs straight from the bare repo** (no clone). **Writes** clone a throwaway
  worktree, commit, push back.
- Paths are **logical git paths**: repo-relative, `/`-separated, no leading `/`, no `..`.
  Validate at the controller (→ 400 `BadRequestError`) and again in `GitService` (defense in
  depth). Reads are inherently traversal-safe because they use the git object model.

## 8. Testing — integration only

- **No mock-based unit tests.** Stubbing repos proves nothing; it only produces fake coverage.
  Deleted `TeamServiceTest` (mockk) for exactly this reason.
- Write **integration tests in mt's style**: `@SpringBootTest @AutoConfigureMockMvc
  @TestInstance(PER_CLASS) @TestMethodOrder(OrderAnnotation)`, constructor-inject `MockMvc` +
  `UserCreatorService`, `@BeforeAll` creates real users and logs in **through the real
  cheese-auth service**, ordered tests share state, assert with `jsonPath`. See
  `src/test/kotlin/org/rucca/microteams/api/{TeamTest,DocumentTest,ThreadTest,MachineTest,MachineLinkTest,AgentLoopTest}.kt`.
- **Depending on external services (Postgres, cheese-auth) is the point of integration
  testing, not a smell.** `UserCreatorService` inserts a real user row and logs in via
  `application.legacy-url`.
- `GitServiceTest` is the one "unit-ish" test that stays — it uses **real JGit** on temp
  dirs, no mocks, so it's integration-style already.
- `AgentLoopTest` proves the whole agent loop without a real Claude: a fake machine (a real
  WebSocket client) enrolls, a human opens an agent on it, a chat message must arrive as a `say`,
  and the "agent" answers through the tool-door. It also pins `/openapi.json`'s advertised
  tool-door path to the route that actually serves it — **nothing else catches that drift**, and
  when it drifted, every reply from a live agent 404'd while all tests stayed green.
- Every new endpoint / behavior / bug fix gets an integration assertion. These tests have
  caught real bugs mocks never would: the enumerate/read auth bypass, the dropped
  `@Enumerated`, the 404/400-vs-500 error contract, the `owned` resourceType mismatch.
- Tests must be **hermetic**: inject config via `SPRING_APPLICATION_JSON`, and point
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
./mvnw test   # all of it; needs Postgres:5433 + cheese-auth:8091 up
```

## 9. Schema changes → drop the test DB

- `ddl-auto=update` **never drops** columns or constraints, so a stale test DB drifts from the
  entities and hides/creates bugs. After changing any entity, reset:
  `DROP SCHEMA microteams CASCADE; CREATE SCHEMA microteams;` and let Hibernate recreate it.
- Documents live on disk keyed by team id, which **resets when you drop the DB** — so also use
  a fresh `application.git-repo-base` (the tests already do via `mktemp -d`). Otherwise a new
  team reuses an old id whose git repo still exists and inherits stale files.

## 10. Secrets & runtime config

- `application.properties` holds **only generic local-dev/CI defaults**. Real values — DB
  password, the jwt-secret that must match cheese-auth, `application.legacy-url` — are injected
  at runtime via CLI `--spring.*` args or `SPRING_APPLICATION_JSON`. **Never commit real
  secrets** (we've had a real leak; don't repeat it).
- Building the jar (`mvnw install`) runs an antrun step that boots the app to regenerate
  `CREATE.sql (backend root)`, so it needs a reachable DB configured.

## 10b. Dependencies — a multi-artifact library must move as one version

A dependabot bump to a **single** artifact of a multi-jar library skews it against its siblings.
`jersey-media-multipart` got bumped to 4.0.2 while `jersey-client` / `jersey-hk2` /
`jersey-media-json-jackson` stayed 3.1.10; the 4.x jar dragged in `jersey-common` 4.x, whose
`org.glassfish.jersey.innate.spi.MessageBodyWorkersSettable` does not exist in the 3.1.10 client,
so every request died with `NoClassDefFoundError`. Keep all of a library's artifacts pinned to
**one** version, and be wary of a dependabot PR that touches only one of them.

Note: this and the all-open trap (§3) were both latent — the tests never exercised them until this
refactor added the first test that boots the full context with the lazy `UserProfile` graph. A
green `-DskipTests` build proves nothing about either.

## 11. Commits (solo repo)

- **Commit only code you have personally verified** (green integration tests). Do not let
  bad-then-deleted churn land in history — with one developer, keep the log clean.
- Use `feat(module): …` style messages.
