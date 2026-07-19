# CLI conventions (the `microteams` connector)

The `microteams` binary is a **generic terminal-hosting host**, not an app. It logs a
machine in to a server, holds a control channel, and lets the server open **screens** and
run **applets** on them. It carries **zero** knowledge of what those screens are for. See
`README.md` for the full model.

## 0. Cardinal rule — the Go host is business-agnostic; features live in the applet

**The Go binary provides only generic, business-agnostic primitives. Every specific feature
is implemented in an applet** (server-supplied JavaScript, authored in the `applets/`
module, bundled to goja JS). The two applet surfaces and their whole vocabulary:

- **Screen applet** (`applets/src/screen/index.ts` → `claude.js`): drives a program in a
  terminal. Primitives: read/write the terminal, `microteams.own`/`watch` (mirrored
  variables), `microteams.expose`/`call` (functions both ways). Nothing program-specific
  is in Go — the driver (backend `agent/driver`) picks the applet.
- **CLI applet** (`applets/src/cli/index.ts` → `cli.js`): defines the `microteams api`
  command tree. Primitives: `microteams.command` (declare a command), `microteams.http`
  (one **authenticated** backend call — the agent-token exchange is handled for you in
  `internal/apiauth`, never in the applet), `microteams.exec` (run a subprocess:
  `exec(name, args, {cwd})` → `{code, stdout, stderr}`), `microteams.fs` (sandboxed file
  IO), `microteams.print`.

**Why this matters, and why it is a hard rule:** in production the binary must be
**near-frozen**. A new feature ships by updating the **server-side applet** and reaches
every machine instantly — no `microteams update`, no binary redistribution, no version
skew. The moment a feature needs a new Go binding, rolling it out means updating the
binary on every connected machine, which is exactly the friction this architecture exists
to remove.

**So, when adding an agent-facing feature:**
1. Implement it in the applet (`applets/`), using the existing primitives.
2. If a primitive is *genuinely* missing, add a **general** capability — never a
   business-specific binding. `microteams.exec` gaining a `cwd` option is right; a
   `microteams.gitPush()` is wrong. Adding a general primitive is a rare, deliberate event.
3. Backend changes are **not** subject to this rule — the server is meant to evolve. Prefer
   moving new logic into the applet + backend and leaving the Go host untouched.

Worked example (document-tree git flow): the applet runs `git` via `microteams.exec`
(`git -C <dir>` for the working copy, `-c http.extraHeader="Authorization: Bearer <jwt>"`
for auth) and gets `{gitUrl, token}` from a small **backend** endpoint via
`microteams.http`. No Go change. (The agent JWT is sealed inside `internal/apiauth` and is
never handed to applet JS — an agent "is just a user" with no loose token — so a `git`
subprocess, which authenticates outside `microteams.http`, must be given its credential by
the backend, not by a new host binding.)

## 1. What the Go host owns (and may change carefully)

- **The frozen wire protocol** (`internal/link`, `link.Msg`) between host and server. Treat
  it as frozen — both ends must agree, and the server can't be updated in lockstep with
  every machine. Extend additively, never break.
- **Auth** (`internal/apiauth`): resolves how this machine authenticates — machine token, or
  the per-screen agent-token exchange — and hands out an authenticated `http.Client`. This
  is the one place the "an agent is an ordinary user" rule is implemented.
- **The command tree** (`main.go`): `auth`, `link`, `status`, `run`, `update`, `uninstall`,
  and `api` (loads the server's CLI applet). These are host lifecycle, not features.

## 2. Style

- `gofmt` before committing. Interactive git flags are unavailable in this environment.
- The module path is `github.com/micro-teams/microteams/cli`; the binary is `microteams`.
- Unix only (Linux/macOS); Windows is intentionally excluded (`syscall.SIGUSR2`).
- Tests: table/httptest style next to the code (`internal/commandapplet/commandapplet_test.go`
  exercises the whole describe → cobra → run → http path against a fake server).
