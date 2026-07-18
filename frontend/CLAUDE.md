# Frontend conventions

React 19 + Vite + Tailwind v4 + TypeScript. Talks to two backends: **cheese-auth** (identity,
proxied at `/api`) and **mt** (teams / documents / chat / machines / agents, proxied at `/mt` —
see `vite.config.ts`).

---

## 1. The API client is GENERATED. Never hand-write it.

`src/api/` is generated from the repo-root **`MicroTeams-API.yml`** — the same single contract the
backend generates its `*Api` interfaces from. That is the whole point: `ChatApi` exists on both
sides, from one file, so the two cannot drift.

- **Never edit anything under `src/api/`.** It is overwritten on every build.
- **Changed the API? Edit `MicroTeams-API.yml` first**, then regenerate. The backend regenerates on its
  own build; the frontend regenerates via:

  ```bash
  npm run codegen
  ```

  You should not normally need to run it by hand: `predev` and `prebuild` are npm lifecycle hooks
  that run `codegen` automatically, so **`npm run dev` and `npm run build` always regenerate
  first**. A stale client is therefore not a state you can accidentally be in — but if you edit
  `MicroTeams-API.yml` while `npm run dev` is already running, restart it (Vite will not re-run the hook).
- The generator is pinned in `openapitools.json` to **7.10.0**, the same version
  `backend/pom.xml` uses. Keep them equal.

## 2. Calling the backend

Use the generated APIs through the single configured client in `src/lib/mtApi.ts` — it carries the
`/mt` base path, injects the Bearer token, and retries once through the silent-refresh hook on a
401. Do not construct `Configuration` or call `fetch` against mt anywhere else.

```ts
import { chatApi } from "@/lib/mtApi";

const { chats } = await chatApi().listChats({ pageSize: 50 });
```

The generated method names are the yaml's `operationId`s, and the argument/response types are the
yaml's schemas — if a call does not type-check, the contract disagrees with you, and the yaml is
right.

## 3. What still is hand-written

- `src/lib/api.ts` — the cheese-auth client. cheese-auth is a separate service with its own
  (enveloped `{code,message,data}`) contract and is **not** in `MicroTeams-API.yml`.
- The 现场 viewer's WebSocket (`src/components/TerminalViewer.tsx`) and the STOMP chat socket.
  WebSockets cannot be described by OpenAPI, so they are wired by hand against the paths the
  backend registers (`/machine/screen/{sid}`, `/mt/ws`). If those move, they move here too.

## 4. Avatars

Every avatar in the app — human or agent, anywhere — is the one `UserAvatar` control. It tracks
presence, draws the inference ring while an agent is working, and opens 现场 on click. Do not
render a bare `<img>` or a second avatar component: the point is that one control means every
avatar everywhere gains the same behaviour at once.
