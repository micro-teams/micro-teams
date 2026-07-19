# MicroTeams — frontend

The MicroTeams web client: React 19 + Vite + Tailwind v4 + TypeScript, mobile-first. It talks to
two backends through nginx's same-origin gateway — **cheese-auth** (identity) at `/api` and **mt**
(teams, documents, chat, machines, agents) at `/mt`.

## Develop

```sh
npm install
npm run dev        # :5173 — proxies /api → :8091 and /mt → :8199 (see vite.config.ts)
```

Point the proxies elsewhere with `AUTH_BACKEND_URL` / `MT_BACKEND_URL`. Full local bring-up
(cheese-auth + backend + nginx) is in the [repo root README](../README.md).

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server (regenerates the API client first) |
| `npm run build` | typecheck + production build (regenerates the API client first) |
| `npm run lint` | oxlint |
| `npm run format` / `format:check` | prettier |
| `npm run codegen` | regenerate `src/api/` from `../MicroTeams-API.yml` |

## The one rule that bites

**`src/api/` is generated from the repo-root `MicroTeams-API.yml` and must never be hand-edited** —
it is overwritten on every build (the `predev`/`prebuild` hooks run `codegen`). Change the API by
editing the YAML first, then regenerate. See [`CLAUDE.md`](./CLAUDE.md) for the rest of the
conventions (the single `mtApi` client, the one `UserAvatar` control, what stays hand-written).
