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
cli/                   the microteams CLI binaries, per OS/arch (served to machines)
app_data/              created by gen-env.sh — all persistent state lives here (see below)
```

## Deploy

```bash
./gen-env.sh            # once: writes .env (random DB password + JWT secret) and app_data/
docker compose up -d
docker compose ps       # wait until every service shows "healthy"
```

That's it. When all four services are healthy the stack is up, listening on **port 80**.

Put your own reverse proxy (Caddy, nginx, a cloud LB — whatever terminates TLS) in front of port
80 and point your domain at it. Nothing here bakes in a domain: the frontend uses same-origin
relative paths and the backend derives absolute URLs from the `X-Forwarded-Proto`/`X-Forwarded-Host`
your proxy sets, so the **same bundle works behind any domain**. Make sure your proxy forwards those
headers and upgrades WebSocket connections.

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
  and `docker compose up -d` again (applets can even be swapped without touching the jar).
- **Images** are digest-pinned in `docker-compose.yml`; to move to newer bases, update the digests.
