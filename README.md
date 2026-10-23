# MicroTeams

A collaboration substrate that turns AI agents into long-lived team members working alongside
humans. An agent here is not a chat box: it is **a real user account** that drives a real CLI
(Claude Code today) on a real machine, and it takes part in the same groups, under the same
permissions, as the people it works with.

The rule the whole thing is built to keep: **whatever we used to enforce with prompts and social
convention should become an invariant the platform enforces in code.** Prompts drift and get
forgotten; code does not.

## What is here

| | |
|---|---|
| **`MicroTeams-API.yml`** | The single API contract. The backend's interfaces and the client's are both **generated** from it. |
| **`backend/`** ("mt") | Kotlin / Spring Boot. Chat, teams, git-backed documents, machines, agents. |
| **`app/`** | Flutter. The client: web today, Android / iOS / desktop from the same code. Served at `/app/` in a deployment. |
| **`site/`** | The marketing site at the deployment's root ("/") — plain HTML/CSS/JS, no build step, independent of `app/`. |
| **`cli/`** | Go. Runs on a machine, hosts the agent's CLI, speaks the connector protocol. |
| **`applets/`** | TypeScript, bundled for the CLI's embedded JS runtime: the `microteams api` command tree (the agents' frontend) and the screen drivers. Served by the backend, fetched by the CLI on demand. |
| **cheese-auth** | A *separate* repo (`micro-teams/cheese-auth`, NestJS): registration, login, avatars. Runs as a prebuilt image in deployment; cloned as a sibling for local dev. Not part of this monorepo. |

### One contract, generated both ways

`MicroTeams-API.yml` is the source of truth and neither side hand-writes its client:

- the backend regenerates `app.microteams.api.*Api` on every build, and each module's single
  controller implements exactly its own interface — nothing else;
- the client regenerates `app/packages/mt_api` via `app/tool/codegen.sh` (run by CI before it
  builds anything, and gitignored so a stale or hand-edited copy cannot be committed);
- the applets regenerate `applets/src/api` (`npm run codegen`), including an op table every
  `microteams api` command calls through, so a request or response that no longer matches the
  contract fails `npm run typecheck`.

The generator names an Api class after a path's **first segment**, so the path *is* the structure:
`/chat` → `ChatApi` → `chat/ChatController`, on both sides, from one file. Change the API by
editing the yaml first; if your call stops type-checking, the contract disagrees with you and the
contract is right.

WebSockets are the one thing OpenAPI cannot describe — `/machine/link` (the CLI's control
channel), `/machine/screen/{sid}` (the live terminal), `/mt/ws` (chat) — so those are wired by
hand and have to be kept in step deliberately.

### The three layers behind an agent

```
machine/       a host running our CLI: a control channel, and screens.
               Knows nothing about agents — a screen is a hosted process with an
               opaque kind, so a shared shell or a vscode-server needs no agent
               and no pretending to be one.
team/machine/  whose a machine is. mayAccess(user, machine) is the only access
               question anyone asks about a machine.
agent/         one application that happens to run on a machine. `Agent` mentions
               no screen at all; agent/driver/ is the only code in the backend that
               knows Claude Code exists, and a driver is exactly two things — the
               argv, and the applet that reads the terminal. Codex = one new driver.
```

Chat reaches an agent by **callback, not lookup**: the agent registers as a `ChatSubscriber` as
itself, and chat — which owns "who is in this group" — calls it. Chat never imports agent.

## Two frontends: the app and `microteams api`

People use MicroTeams through the app; agents use it through `microteams api` (`applets/src/cli`).
An agent is an ordinary user, so the two are meant to reach the same things: **a user-facing
function should be available in both**, normally added to both in the same change. The CLI is
laid out like the app rather than like the API — one group per area of the app (`chat`, `docs`,
`team`, `agent`, `machine`), the app's actions as its verbs — with `say` as the single top-level
shortcut because it is what an agent does every turn.

This is a convention, not a CI check: the API changes rarely, and some things are deliberately on
one side only. The known exceptions:

- agent-only: announcements to agents (humans never receive them);
- app-only: sign-in and registration (cheese-auth), uploading an avatar image, writing a document
  through the API — an agent edits documents in its git checkout and publishes with `docs sync`;
- neither: transport internals (`/ping`, `/probe`, `/lines`) and the connector's own plumbing
  (token exchange, the git-workspace credential, enrollment start/poll).

## Architecture

```mermaid
flowchart TD
    browser(["browser"]) -->|one public origin| nginx["nginx"]
    nginx -->|"/"| site["site<br/>static marketing pages"]
    nginx -->|"/app"| app["app<br/>Flutter web · :8931 in dev"]
    nginx -->|"/api"| auth["cheese-auth<br/>NestJS · :8091"]
    nginx -->|"/mt"| mt["mt<br/>Kotlin / Spring · :8199"]
    cli["cli<br/>on your machine"] -->|WebSocket| mt
    cli --> claude["Claude Code<br/>in a tmux screen"]
    auth -->|public schema| pg[("Postgres")]
    mt -->|microteams schema| pg
```

Everything the browser touches is **one origin** — nginx puts all three behind it at different
path prefixes — so there is effectively no cross-origin request and cheese-auth's `httpOnly`
refresh cookie simply works. The web build calls relative paths only (`/api/...`, `/mt/...`),
never an absolute backend URL. That is required, not tidiness. (A NATIVE build has no proxy in
front of it and therefore no same-origin to rely on, which is why it must be told where the server
is at build time — see `app/README.md`, and note that the cookie story differs there.)

Both backends trust the **same JWT** because they share `JWT_SECRET`: mt verifies the signature
itself and never calls cheese-auth to check a request. (`application.legacy-url` is a different,
narrower thing: mt's own server-to-server calls for data it does not own.)

## Running it locally

Prerequisites: JDK 21, Node.js, Go, Docker + Compose, nginx.

### 1. cheese-auth (identity)

```sh
cd ..                       # a sibling directory, not inside this repo
git clone https://github.com/micro-teams/cheese-auth.git && cd cheese-auth
cp sample.env .env
```

In `.env`: `PORT=8091`; `JWT_SECRET` — **the same value** mt will use, the only thing linking the
two services' auth; `CORS_ORIGINS` / `FRONTEND_BASE_URL` → your public origin; `COOKIE_BASE_URL=/`;
and real SMTP credentials if registration mail should actually send
(`EMAIL_SMTP_SSL_ENABLE=false` for a STARTTLS port like 25, `true` for implicit TLS like 465).

mt needs its own schema in the **same** database, and cheese-auth's compose file does not publish
the DB port:

```sh
cat > docker-compose.override.yml <<'YAML'
services:
  cheese-auth:
    build: .          # build from source; the published tag can lag this fork
  database:
    ports: ["5433:5432"]
    volumes: ["./.local-init:/docker-entrypoint-initdb.d"]
YAML
mkdir -p .local-init && echo 'CREATE SCHEMA IF NOT EXISTS microteams;' > .local-init/001-microteams-schema.sql
docker compose -p microteams-auth up -d --build
curl http://localhost:8091/status     # {"code":200,...}
```

**Schema separation:** mt's `User` / `UserProfile` / `Avatar` are shared, read-mostly mirrors of
cheese-auth's `public` tables and carry an explicit `schema = "public"`; everything else mt owns
defaults into `microteams` via `hibernate.default_schema`. Don't remove those overrides.

### 2. backend (mt)

```sh
cd backend && ./mvnw install
```

The tests are integration tests and need Postgres + cheese-auth up — that is the point, not a
smell (`backend/CLAUDE.md` §8). `install` also regenerates `backend/CREATE.sql` from the live
entities, so it needs a reachable DB too.

```sh
java -jar target/backend-0.1.19.jar --server.port=8199 \
  --spring.datasource.url=jdbc:postgresql://localhost:5433/mydb \
  --spring.datasource.username=username --spring.datasource.password=<db-pw> \
  --application.legacy-url=http://localhost:8091 \
  --application.jwt-secret=<same JWT_SECRET as cheese-auth> \
  --application.cors-origin=http://your-host \
  --application.git-repo-base=/var/lib/microteams/git \
  --application.connector-origin=http://your-host:8199
```

Config is read at **build** time, so editing `application.properties` after packaging changes
nothing — override on the command line as above, or rebuild. Never commit real secrets.

`curl :8199/ping` → 401 with no token; `{"code":200,"message":"pong from user <id>"}` with one.

### 3. app (the client)

```sh
cd app && bash tool/codegen.sh && flutter run -d chrome
```

For a build you can serve, plus the browser checks that assert it actually starts (and starts
offline):

```sh
flutter build web --release --no-web-resources-cdn && node tool/launcher.mjs build/web && node tool/make-sw.mjs build/web
npm ci && npx playwright install chromium && bash tool/check-web.sh
```

Point it at the backends the same way nginx does — a dev server on the same origin, or
`--dart-define=MT_ORIGIN=...` for a native build. See `app/README.md`.

### 4. nginx

```nginx
server {
    listen 80;
    server_name your-host;

    location /api/ { proxy_pass http://127.0.0.1:8091/; include proxy_params; }
    location /mt/  { proxy_pass http://127.0.0.1:8199/; include proxy_params;
                     proxy_http_version 1.1;             # the CLI link + live-screen WebSockets
                     proxy_set_header Upgrade $http_upgrade;
                     proxy_set_header Connection "upgrade"; }
    location /     { proxy_pass http://127.0.0.1:5173;  include proxy_params;
                     proxy_http_version 1.1;             # vite HMR
                     proxy_set_header Upgrade $http_upgrade;
                     proxy_set_header Connection "upgrade"; }
}
```

`proxy_params` is Debian's; elsewhere set `Host` / `X-Real-IP` / `X-Forwarded-For` /
`X-Forwarded-Proto` yourself — mt builds the machine-approval URL out of the forwarded headers.

### 5. Connect a machine, open an agent

```sh
cd cli && go build -o microteams .
./microteams auth login http://your-host:8199    # prints a link; a team member approves it
./microteams link connect                        # installs the background service (`./microteams run` to stay in the foreground)
```

Then open an agent on that machine (`POST /agent` with `machineId`, `teamId`, `nickname`), add it
to a group, and talk to it. Click its avatar anywhere to watch its live terminal (the live screen).

## Gotchas

- **The permission table is the authorization model.** `RolePermissionService` has to read as
  *the* answer to "who may do what": no service checks permissions, and no rule exists outside
  it. `backend/CLAUDE.md` §5.
- **`./mvnw clean` after moving/renaming/deleting Kotlin sources.** `target/classes` keeps stale
  `.class` files and the compiler resolves against them, producing impossible errors.
- **Generated code is never hand-edited**, on either side — it is overwritten on every build.
- **An agent's `/openapi.json` is not the contract** — it is a small runtime document listing what
  an agent may call. If it drifts from the real route, every reply from a live agent 404s while
  every test stays green. `AgentLoopTest` pins it.
- **Email verification needs a real inbox**, or insert a code directly:
  `INSERT INTO user_register_request (email, code, created_at) VALUES ('you@ruc.edu.cn', '123456', CURRENT_TIMESTAMP);`
  Only `@ruc.edu.cn` passes cheese-auth's suffix check.
- **cheese-auth's `prisma db push` runs once**, gated by a flag file on the uploads volume. Reset
  the database volume without the uploads volume and initialization is silently skipped — delete
  the flag if you ever see `table "public.avatar" does not exist`.

## Working in this repo

Nothing here can be built or tested from the root. `app/` needs `bash tool/codegen.sh` first —
`packages/mt_api` is generated from the contract and gitignored, so a fresh clone has no package to
resolve against — then `flutter test`. `backend/` is `./mvnw test`. `cli/` is `go test ./...`.
`applets/` is `npm ci` (it needs `NODE_AUTH_TOKEN` with `read:packages`, see `applets/.npmrc`) then
`npm run build`. `backend/` and `cli/` have their own conventions in `backend/CLAUDE.md` and
`cli/CLAUDE.md`.

### Which test to write

**Prefer a step in the journey.** `app/integration_test/journey_test.dart` drives the real client
against a real deployment: the bundle CI built, its own nginx, a machine with the connector on it,
and the real Claude Code in front of a mock Anthropic API. A step added there is the only evidence
that a feature *works once the whole thing is deployed* — which is the question a person actually
has, and the one nothing below can answer.

That is not a preference for slow tests. It is what the last year of this repository keeps
demonstrating: the failures that reached customers were never a unit that computed the wrong value.
They were a socket registered at a path the gateway strips, a code sent to an address the form had
overwritten, a screen the client never subscribed to. Every one of those has a green component test
next to it, and every one of them was found by driving the product.

So when you add behaviour, the first question is **which step of the journey proves it**, not which
unit test covers it.

### When a component test is right anyway

A component test earns its place when the journey *cannot ask its question*. Four kinds do:

- **What must NOT be sent.** The journey sees what happened; only a test holding the wire sees that
  a field was absent, and "nothing was sent for the empty box" is a real requirement.
- **A branch the product cannot be made to take.** A dead socket, a truncated frame, a 500 from a
  dependency: a fake reaches states a running deployment will not produce on demand.
- **A shape, measured.** Bubble width against a wall of unbreakable text, a colour, two widgets the
  same height. The journey checks a few of these because they were regressions; the rest belong
  where they can be measured cheaply.
- **A contract with somebody else's format.** Parsing, serialising, escaping — the cases are the
  point, and there are dozens of them.

Anything else, ask whether the journey already covers it or could. A component test that only
repeats a journey step costs a run every time and can go green while the product is broken — which
is exactly how each of the failures above got through.

### Two rules that have cost us

**A test that can never go red is not a test.** Before you keep one, break the thing it covers and
watch it fail. Several of ours could not, and deleting them lost nothing.

**Say what the number is, not that it is fine.** A test named `testUpdate` that asserts `!= null`
tells the next person nothing about which behaviour they just broke.

## License

This project is licensed under the GNU Affero General Public License v3.0 — see [`LICENSE`](LICENSE).
