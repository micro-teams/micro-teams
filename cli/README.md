# microteams

`microteams` is the binary a user installs on a machine so the MicroTeams backend can open
**screens** there and drive them — with no further client updates, ever.

**Almost none of that mechanism is in this directory.** It lives in
[micro-connector](https://github.com/micro-teams/micro-connector), the connector shared with the
other products built on the same idea: the terminal, the applet runtime, screen lifecycle, both
transports, enrolment, credentials, self-update and the service install are all library. What is
here is what makes this connector *MicroTeams* rather than something else (see _What is actually
in this directory_).

The binary is still self-contained: it depends on nothing but a `tmux` and a POSIX pty.

## The model

A screen is a program running in a terminal. The server drives each screen two
independent ways at once:

1. **An applet** — a small piece of JavaScript the server hosts inside the
   screen. Its entire world is three affordances, and nothing else:

   - **a terminal** it can read (the current screen) and write (keystrokes);
   - **variables**, of two kinds:
     - *script-owned* (A-class): the applet writes them, the server sees a
       live read-only mirror — `microteams.own(name, initial)` → `{get, set}`;
     - *server-owned* (B-class): the server writes them, the applet observes
       — `microteams.watch(name)` → `{get, onChange}`;
   - **functions**, in both directions — `microteams.expose(name, fn)` lets the
     server call the applet; `microteams.call(name, ...args)` (a Promise) lets the
     applet call the server.

   The applet is a trusted, dynamic part of the CLI — it is delivered by the
   server, so any policy (what to watch, what to expose, what keys to allow)
   lives *there*, expressed once, never duplicated in the host.

2. **The raw screen channel** — separately, the server can attach to a screen's
   live byte stream and read/write it directly (the live screen): full-fidelity
   terminal in, keystrokes and resizes out. This is what a browser terminal
   rides on. It is independent of the applet.

The host binary is a dumb, safe sandbox that offers exactly these affordances
and ascribes meaning to none of it. Read the code in `internal/` and you cannot
tell what it is used for — that is the point.

## Commands

Two groups mirror the two ideas — who this machine is, and whether it is
connected:

```
microteams auth login [server-url]   log this machine in (device flow)
microteams auth logout               forget the credential (disconnects first)

microteams link connect [server-url] connect, and reconnect on every boot (runs login if needed)
microteams link auto-connect         the same thing, said the other way
microteams link disconnect           disconnect (warns if screens are running)
microteams link no-auto-connect      disconnect and stop reconnecting on boot

microteams status                    login, connection and screen count at a glance
microteams api <command> [args]      the server-defined command tree (see below)
microteams update                    fetch a new binary and hand off to it, keeping screens alive
microteams uninstall                 remove the CLI entirely (service, config, binary)
```

Commands meet the user where they are: `link connect` starts the login flow if
the machine isn't logged in yet; `link disconnect` warns (and asks) when live
screens would be killed; every success message says what to do next. The server
URL is remembered after the first login — installers can pre-seed it, after
which no command ever needs a URL.

**Login is a device flow.** `microteams auth login` registers the machine, prints a
link, and blocks until a human opens it and approves. On approval the server
hands back a durable credential representing this device (it does not expire —
revoke it server-side). The credential is stored at
`~/.config/microteams/config.json`; both the long-running host and `microteams api` read
it, so a machine is configured once. How the user authenticates on that link is
entirely the server's business.

**Self-contained tmux.** The host prefers a private tmux at
`~/.config/microteams/bin/tmux` (placed there by an installer; `$MICROTEAMS_TMUX`
overrides) and only falls back to the system tmux — so a machine without tmux
works, and a machine with a quirky one is never at its mercy.

Its socket lives at a **stable** per-user path, not a fresh one per run: the tmux server outlives
this process, so a restarted or self-updated binary has to arrive back at the same socket to find
the sessions it left behind. That is also why the path is part of the brand — two connectors from
different products sharing it would each see the other's screens.

**`microteams api`** runs the server-hosted **CLI applet** (`cli.js`): the applet
declares the whole command tree with `microteams.command`, and the host turns that
declaration into subcommands, rebuilt from the applet each run so it never goes
stale. The command set therefore lives on the server — a new command ships by
updating the applet, not the binary. It is hidden from the top-level help; run
`microteams api` to list commands and `microteams api <cmd> -h` for one command's
help. Two things happen automatically on any backend call the applet makes:

- the stored credential is attached as `Authorization: Bearer …`;
- if the call comes from **inside a screen**, it is tagged with that screen's
  token via `X-Microteams-Screen`. The host injects a per-screen token as
  `MICROTEAMS_SCREEN` into every process a screen spawns, so the server can tell
  exactly which screen (and thus which hosted program) made any given call —
  with no cooperation from the program itself.

## Build

```bash
go build -o microteams .
# cross-compile (CGO-free) for the supported targets:
GOOS=linux  GOARCH=amd64 CGO_ENABLED=0 go build -o microteams-linux-amd64 .
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o microteams-darwin-arm64 .
```

Runtime needs `tmux` and a pty (Linux and macOS; no Windows).

## What is actually in this directory

```
main.go             the command tree's root; declares the brand before anything reads a path
internal/daemoncmd  the human-facing commands, and how they speak
internal/host       assembles a connector out of the library, plus MicroTeams' own three
                    decisions: the state file, what updating means, and the bargain that keeps
                    agents alive across an update
internal/lines      which network paths to the backend exist
internal/netcfg     this machine's own network settings (its proxy)
internal/hostlog    one log file, wherever the init system put the process
internal/acpscreen  `microteams acp-screen`: a terminal front end for agents that speak ACP
internal/mtbrand    which product this is — and that agents here are ordinary users, so a screen
                    exchanges its token for the user's rather than borrowing the machine's
internal/state      how many screens are live, so a disconnect can warn before killing work
internal/ui         terminal output
```

Everything else comes from `github.com/micro-teams/micro-connector/cli`, pinned in `go.mod`. A
change to the terminal, the applet runtime, screen lifecycle, the transports, the wire protocol,
enrolment, config, credentials, self-update or the service install belongs in that repository —
where an end-to-end test drives a real coding agent — and arrives here by bumping the dependency.

## Conventions

### The Go host is business-agnostic; features live in applets

**The binary provides only generic primitives. Every specific feature is implemented in an
applet** (server-supplied JavaScript). The two applet surfaces:

- **Screen applets** (`claude.js`, `codex.js`, …) drive a program in a terminal with the
  primitives described under _The model_. They are published from micro-connector as
  `@micro-teams/connector-applets`, because understanding what a coding agent paints on a terminal
  is the expensive part and it goes stale with every release of that agent.
- **The CLI applet** (`applets/src/cli/` → `cli.js`) defines the `microteams api` command tree.
  Primitives: `microteams.command` (declare a command), `microteams.http` (one **authenticated**
  backend call — the agent-token exchange is the connector's job, never the applet's),
  `microteams.exec` (run a subprocess: `exec(name, args, {cwd})` → `{code, stdout, stderr}`),
  `microteams.fs` (sandboxed file IO), `microteams.print`.

This is a hard rule because in production the binary must be **near-frozen**. A feature ships by
updating the **server-side applet** and reaches every machine at once — no `microteams update`, no
binary redistribution, no version skew. A feature that needs a new Go binding has to be rolled out
to every connected machine, which is exactly the friction this architecture exists to remove.

When adding an agent-facing feature:

1. Implement it in the applet (`applets/`), using the existing primitives.
2. If a primitive is *genuinely* missing, add a **general** capability — never a
   business-specific binding. `microteams.exec` taking a `cwd` option is right; a
   `microteams.gitPush()` is wrong. Adding a general primitive is a rare, deliberate event.
3. The backend is **not** bound by this rule — the server is meant to evolve. Prefer putting new
   logic in the applet + backend and leaving the Go host untouched.

Worked example (the document-tree git flow): the applet runs `git` via `microteams.exec`
(`git -C <dir>` for the working copy, `-c http.extraHeader="Authorization: Bearer <jwt>"` for
auth) and gets `{gitUrl, token}` from a small **backend** endpoint via `microteams.http`. No Go
change. The agent's JWT is sealed inside the connector's credential layer and never handed to
applet JS, so a `git` subprocess, which authenticates outside `microteams.http`, gets its
credential from the backend, not from a new host binding.

### The command tree

`auth`, `link`, `status`, `run`, `update`, `uninstall` and `api` are lifecycle, not features.
**Stopping the service kills every session on the machine**, so a command that only wants the
connector to reconsider something is never built on stop/start. `link retest` is the worked
example: it signals the running process instead, and refuses to signal one that predates the
handler, because SIGHUP to a process that ignores it is a kill.

### The wire protocol is frozen

Both ends must agree, and machines are never upgraded in lockstep with the server. Extend
additively; never break.

### Style and tests

- `gofmt` before committing.
- The module path is `github.com/micro-teams/microteams/cli`; the binary is `microteams`.
- Unix only (Linux/macOS); Windows is intentionally excluded (`syscall.SIGUSR2`).
- Tests are table/httptest style, next to the code. The connector's own tests — including the ones
  that drive a real tmux and a real coding agent — live in micro-connector; a change to this
  directory is verified by `.github/scripts/e2e.sh`, which builds the shipped bundle and puts a
  machine through it.
- **A test never touches the live tmux socket.** The socket is a stable per-user path by design,
  so a test that builds a screen manager without redirecting `TMPDIR` drives whatever connector is
  running as that user, and killing its server at the end of the test kills every agent on the
  machine — with no error, exactly as if tmux had died on its own.

## The consumer

This monorepo's **backend** (`../backend`, the `mt` service) is the server that drives this host:
`agent/driver` picks a screen applet (`claude.js`) to run Claude Code in a screen, and
`agent/AppletController` serves the CLI applet (`cli.js`) that defines `microteams api`. The CLI
applet is authored in `../applets`; the screen applets come from the shared package. Nothing in the
connector knows any of that is about AI — read it and you cannot tell what it hosts, which is the
point.
