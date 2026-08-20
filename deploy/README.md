# MicroTeams — deployment bundle

This is a self-contained deployment: stock Docker images (nginx, a JRE, postgres) with this
project's build artifacts **bind-mounted** into them. There are no custom images to build or pull
from a registry, and every image is pinned by digest so a deploy is reproducible.

## What's in here

```
docker-compose.yml     the four services (nginx, backend, cheese-auth, postgres)
nginx.conf             the domain-independent gateway (SPA + /api + /mt)
gen-env.sh             generates .env with fresh random secrets
init/                  postgres first-init SQL (creates the "microteams" schema)
CREATE.sql             the full table structure this build expects (reference only — see Upgrading)
backend/backend.jar    the backend
frontend/dist/         the built SPA (static, domain-independent)
applets/               cli.js + claude.js (mounted into the backend, swappable)
connector/             the CLI distribution served to fresh machines: per-target dirs each
                       holding the `microteams` binary + a static `tmux` (Linux only — see below)
app_data/              NOT shipped — gen-env.sh creates it; all persistent state lives here (see below)
```

## Fresh-machine install (`curl … | sh`)

A machine with nothing installed joins in two commands:

```bash
curl -fsSL https://<your-domain>/install.sh | sh   # drops the microteams binary + a private tmux
microteams link auto-connect                       # enroll (approve in the browser) + boot service
```

> **Run as a normal user, not root.** `| sh` installs to your `~/.local/bin`, and
> `microteams link auto-connect` registers a boot service that runs *as you* (`User=<you>`),
> so the connector — and every agent it launches — runs under your account. This matters:
> Claude Code refuses `--dangerously-skip-permissions` as root, so an agent started by a
> **root** connector hangs. `| sudo sh` works for the install too (binary → `/usr/local/bin`,
> config stays in your home, and the service still runs as the invoking user) — just don't
> install from a root login shell, which would run the connector as root and break agents.
>
> Agents also run `git` on the machine to work a team's document tree, so install git there
> (`apt/dnf/brew install git`); `install.sh` warns if it's missing. The connector itself
> installs and enrolls fine without git.

`install.sh` is served by the backend at the origin root (nginx routes `/install.sh` and
`/connector/…` straight to it, no `/mt` prefix), with the connector base and API base baked in from
your `X-Forwarded-*` origin — so the same bundle works behind any domain with nothing configured.
The binaries it downloads (`GET /connector/latest/<os>-<arch>/{microteams,tmux}`) come from the
top-level `connector/` directory, which CI populates in the bundle:

```
connector/linux-amd64/{microteams,tmux}
connector/linux-arm64/{microteams,tmux}
connector/darwin-amd64/microteams      # macOS static tmux is not published —
connector/darwin-arm64/microteams      # install.sh copies the machine's own tmux
```

It is bind-mounted read-only into the backend at `/app/connector` (the default
`application.connector-binaries-dir`). It lives at the top level, **not** under `app_data/`, because
it is a shipped build artifact, not state — `app_data/` holds only what you back up. To refresh the
CLI for all machines, replace the binaries here and `docker compose up -d` — connected machines
self-update via `microteams update`.

## Deploy

```bash
bash gen-env.sh         # once: writes .env (random secrets + config placeholders) and app_data/
# --> now edit .env: fill in the EMAIL_SMTP_* values (see "Email" below)
docker compose up -d
docker compose ps       # wait until every service shows "healthy"
```

That's it. When all four services are healthy the stack is up, listening on **port 80**.

Nothing else is required to run this. If you also want to be able to see which machines are out
there and what build each is running — and to push one of them an update — see
[Operator access](#operator-access-off-by-default) below; it is off unless you switch it on.

### Email (SMTP) — required, or nobody can register

Registration emails a verification code through **cheese-auth**, so **without working SMTP the
sign-up flow is dead** (the account is created but never verified). `gen-env.sh` writes blank
placeholders into `.env`; fill them before first real use:

| `.env` var | Meaning |
|------------|---------|
| `EMAIL_SMTP_HOST` | your relay's hostname (provider, SES, Postmark, a company mail server…) |
| `EMAIL_SMTP_PORT` | `587`/`25` for STARTTLS/plain, `465` for implicit TLS |
| `EMAIL_SMTP_USERNAME` / `EMAIL_SMTP_PASSWORD` | relay credentials |
| `EMAIL_SMTP_SSL_ENABLE` | `true` only for implicit TLS (465); `false` otherwise |
| `EMAIL_DEFAULT_FROM` | the From header, e.g. `MicroTeams <no-reply@your-domain>` |

**No domain to configure.** cheese-auth builds its verification-email links from the request's own
`X-Forwarded-*` origin, and the backend derives its CORS origin the same way — so this deployment is
domain-agnostic: one instance can sit behind several domains, with nothing about the domain baked in.
(Optional: set `APP_NAME` to rebrand the emails; default `MicroTeams`.)

Put your own reverse proxy (Caddy, nginx, a cloud LB — whatever terminates TLS) in front of port
80 and point your domain at it. Nothing here bakes in a domain: the frontend uses same-origin
relative paths and the backend derives absolute URLs from the `X-Forwarded-Proto`/`X-Forwarded-Host`
your proxy sets, so the **same bundle works behind any domain**. Your proxy must:

- **Forward `X-Forwarded-Proto` and `X-Forwarded-Host`.** They are how the backend learns its own
  public URL to bake into `install.sh` and the connector download links. Get these wrong and machines
  are handed the internal address and can't enroll.
- **Upgrade WebSocket connections.** Two live channels ride WS: the machine control link
  (`/mt/machine/...`) and the terminal stream that renders an agent's screen in the browser. A proxy
  that doesn't pass `Upgrade`/`Connection` headers gives you a working UI where terminals never load
  and machines never connect.
- **Not buffer the terminal stream.** The screen is streamed; a proxy that response-buffers makes it
  update in laggy bursts. (nginx: `proxy_buffering off` for that route — the bundled nginx already
  does this internally; it matters for *your* outer proxy.)

**Cloudflare Tunnel** works with no extra config: `cloudflared` sets the forwarded headers and
handles WebSocket automatically. Just point a tunnel at `http://<host>:80`.

## Operator access (off by default)

There is a second, deliberately separate HTTP surface for whoever runs this deployment: enough to
answer "which machines are out there, what build is each running" and to push one machine an update,
**without opening a database client and without any user account gaining that power**.

It does not exist unless you turn it on. That is not a policy — with no management port configured,
the code that serves these endpoints is never constructed, and a request for `/ops/...` on the normal
port is an ordinary 404. There is no privileged role on the public API, so nothing you can do to a
user account grants any of this.

### Turning it on

Three settings, all three required. In `docker-compose.yml`, add to the backend's
`SPRING_APPLICATION_JSON` (mind the comma on the line above):

```json
        "management.server.port":9090,
        "application.ops.token":"${OPS_TOKEN}"
```

publish that port **to the host's loopback only**, and point the healthcheck at its new home:

```yaml
    ports:
      - "127.0.0.1:9090:9090"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9090/actuator/health/readiness || exit 1"]
```

then put a long random secret in `.env`:

```bash
echo "OPS_TOKEN=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

**Two things here bite if you skip them.**

*The healthcheck.* Actuator moves with the management port. Add the port without moving the
healthcheck and the backend never reports healthy — nothing is wrong with it, compose is just asking
the old address.

*The bind address.* Inside a container, do **not** set `management.server.address=127.0.0.1`: that
binds to the *container's* loopback, and your published port then reaches nothing. The loopback
restriction belongs on the host side, which is what `127.0.0.1:9090:9090` above does — the port is
reachable from that host and from nowhere else.

With `application.ops.token` unset the endpoints answer 404 even with the port open. A blank token
does not mean "no authentication"; it means the surface is closed. That is on purpose: the common
mistake is forgetting to set a secret, and forgetting must fail closed.

### Reaching it

It is not on the internet, and should not be put there. From your laptop:

```bash
ssh -N -L 9090:127.0.0.1:9090 you@your-server
```

Everything below then runs against `http://127.0.0.1:9090` through that tunnel. Even if the token
leaks, it is not something anyone can use from outside the host.

### What's out there

```bash
curl -s -H "X-Ops-Token: $OPS_TOKEN" http://127.0.0.1:9090/ops/machines | jq
```

```json
[
  {
    "id": "dev7f3c91a2b4e8",
    "name": "eu-build-01",
    "online": true,
    "build": "0.1.14",
    "connectedAt": "2026-08-20T04:11:52.331Z",
    "screens": 3,
    "updateRequestedAt": null,
    "buildWhenRequested": null
  }
]
```

`build` is what the machine itself reported. **`null` means it has not told us — not that it is
old.** A connector predating this feature never answers the question, and so does a machine that has
not reconnected since you upgraded the backend. Treat null as "unknown" and go and look.

`connectedAt` is when the machine last attached *to this backend process*, so it resets when you
restart the backend. That is exactly what you want when checking whether a machine came back.

### Pushing one machine an update

```bash
curl -s -X POST -H "X-Ops-Token: $OPS_TOKEN" \
     http://127.0.0.1:9090/ops/machines/dev7f3c91a2b4e8/update | jq
```

```json
{
  "outcome": "requested",
  "machineId": "dev7f3c91a2b4e8",
  "buildBefore": "0.1.13",
  "requestedAt": "2026-08-20T09:02:44.118Z",
  "note": "The machine was asked to update. Whether it did is only knowable by looking: watch it drop, reconnect, and report a build. GET /ops/machines."
}
```

**It says `requested`, and it will never say `updated`.** The machine downloads a new binary and
replaces its own running process; the moment it does, this connection is gone. Nothing on this side
can honestly report the outcome. You establish that by looking: within a few seconds `online` goes
false, then true again, and `build` is the new version. Its agents survive — the update re-execs and
keeps the tmux sessions, so nobody's session dies.

If it does **not** come back, that machine is now down and needs a hand on the box. Which is the
whole reason for the next part.

### Do one, watch it, then do the rest

There is no batch endpoint, on purpose. The way a forced update goes wrong is a binary that does not
start, and a batch is how one of those takes out every machine at once.

```bash
# 1. one machine you can afford to lose, ideally one you can reach another way
curl -s -X POST -H "X-Ops-Token: $OPS_TOKEN" http://127.0.0.1:9090/ops/machines/$ID/update

# 2. watch it leave and come back on the new build
while sleep 2; do
  curl -s -H "X-Ops-Token: $OPS_TOKEN" http://127.0.0.1:9090/ops/machines \
    | jq -r --arg id "$ID" '.[] | select(.id==$id) | "\(.online) \(.build)"'
done

# 3. only then the others, one at a time, checking between each
```

Refusals you should expect, all of them deliberate:

| Response | Meaning |
|---|---|
| `409` + `"machine is offline"` | Nothing was sent. Offline updates are **not** queued: one firing days later, long after you stopped watching, is worse than a failure you can see. |
| `429` | You already asked for this machine inside the last two minutes. A double-click must not mean two re-execs. |
| `404` (with a valid token) | No machine with that id. |
| `401` | Bad or missing `X-Ops-Token`. |
| `404` on **every** ops path | The surface is off — no token configured, or you are talking to the public port. |

### First time through

Version reporting is answered by the connector, so right after you deploy this the `build` column is
`null` everywhere until each machine reconnects. Restarting the backend is enough to make them all
reconnect and report. Machines still running a connector older than this feature never report at all
— for those, the first update is necessarily blind, and after they come back you will see a version
for the first time. That is a one-time bootstrap, not a permanent state.

## State (all under `app_data/`, plain host directories — no docker volumes)

| Path | What |
|------|------|
| `app_data/postgresql/` | the database |
| `app_data/git/` | every team's document tree (a bare git repo per team) |
| `app_data/cheese-auth-uploads/` | avatars / uploaded files |

Back up `app_data/` and `.env` together — `.env` holds the secrets that decrypt nothing but
authorize everything, and losing the JWT secret logs everyone out.

## Notes

- **Secrets** live only in `.env` (chmod 600), generated locally, never committed.
- **Upgrading**: replace `backend/backend.jar`, `frontend/dist/`, or `applets/` with a newer build
  and `docker compose up -d` again (applets can even be swapped without touching the jar). Replace
  files **in place** — overwrite the jar, and for a directory like `frontend/dist/` clear its
  *contents* and copy the new ones in. Do **not** `rm -rf` a directory that's bind-mounted into a
  container and recreate it: the mount follows the original inode, so the container keeps serving
  the deleted one and you get `403 directory index forbidden` / `500` until you restart the
  container. In-place replacement needs no restart; the jar does (`docker compose restart backend`).
- **Schema reference (`CREATE.sql`).** The bundle root carries the full table structure this build
  expects, generated from the backend's JPA entities. It is **not applied on deploy** — the backend
  manages its own tables (`ddl-auto=update` creates and adds, but never drops or rewrites). It's here
  so that when you upgrade you can *see* the current schema and, by diffing this file against the copy
  from the bundle you're replacing (`diff old-bundle/CREATE.sql CREATE.sql`), see exactly what changed
  — a renamed/removed column, a new table, a changed type — and perform any manual migration the
  automatic `update` won't do for you (it never drops or alters existing columns).
- **Live agents survive a backend restart.** Their terminals run in tmux on each machine, and the
  backend re-adopts them when the machine reconnects — so upgrading the jar doesn't kill running
  agents. Connected machines self-update their own connector via `microteams update`.
- **Images** are digest-pinned in `docker-compose.yml`; to move to newer bases, update the digests.
