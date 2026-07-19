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
- **Live agents survive a backend restart.** Their terminals run in tmux on each machine, and the
  backend re-adopts them when the machine reconnects — so upgrading the jar doesn't kill running
  agents. Connected machines self-update their own connector via `microteams update`.
- **Images** are digest-pinned in `docker-compose.yml`; to move to newer bases, update the digests.
