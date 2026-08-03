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

## 1. What is here, and what is not

The connector itself is **not** here. Terminal, applet runtime, screen lifecycle, both transports,
the wire protocol, enrolment, config, credentials, self-update and the service install all live in
[micro-connector](https://github.com/micro-teams/micro-connector), pinned in `go.mod`. A change to
any of them belongs in that repository — where it is guarded by an end-to-end test that drives a
real Claude Code — and arrives here by bumping the dependency.

What this directory owns:

- **The command tree** (`main.go`, `internal/daemoncmd`): `auth`, `link`, `status`, `run`,
  `update`, `uninstall`, and `api` (which loads the server's CLI applet). Lifecycle, not features.
- **Composition** (`internal/host`): which transport, and MicroTeams' own three decisions — how
  the live-screen count is published, what updating means, and the bargain that decides whether
  agents survive an update (`KillServer` on stop; `syscall.Exec` on update, so they do).
- **Identity** (`internal/mtbrand`): every name that makes this connector MicroTeams, plus one
  security semantic — an agent here is an ordinary user, so inside a screen the machine token and
  the screen token are exchanged for that user's own. A product with nobody behind its screens
  sets nothing and speaks as the machine, which is the library's default.

**The wire protocol is frozen**, wherever it lives: both ends must agree and machines are never
upgraded in lockstep. Extend additively, never break.

## 2. Style

- `gofmt` before committing. Interactive git flags are unavailable in this environment.
- The module path is `github.com/micro-teams/microteams/cli`; the binary is `microteams`.
- Unix only (Linux/macOS); Windows is intentionally excluded (`syscall.SIGUSR2`).
- Tests: table/httptest style next to the code. The connector's own tests — including the ones that
  drive a real tmux and a real Claude Code — live in micro-connector, so a change to this directory
  is verified by `.github/scripts/e2e.sh`, which builds the shipped bundle and puts a machine
  through it.
- **Never let a test touch the live tmux socket.** It is a stable per-user path by design, so a test
  that builds a Manager without redirecting `TMPDIR` is driving whatever connector is running as
  that user — and killing its server at the end of the test kills every agent on the machine. That
  happened, twice in one evening, and reads from the outside exactly like tmux dying on its own: no
  error, no OOM, every screen gone at once. The rule lives in micro-connector's CLAUDE.md too,
  because that is where such a test would be written now.
