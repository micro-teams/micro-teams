# microteams

`microteams` is a **generic terminal-hosting mechanism**. You install one small
binary on a machine, log it in to a server, and from then on the server can open
**screens** on that machine and drive them — with no further client updates,
ever. The CLI carries **zero** knowledge of what those screens are for; all the
meaning lives on the server and in the scripts the server sends down.

It is self-contained: this directory builds a single static binary that depends
on nothing but a system `tmux` and a POSIX pty.

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
   live byte stream and read/write it directly (the "现场"): full-fidelity
   terminal in, keystrokes and resizes out. This is what a browser terminal
   rides on. It is independent of the applet.

The host binary is a dumb, safe sandbox that offers exactly these affordances
and ascribes meaning to none of it. Read the code in `internal/` and you cannot
tell what it is used for — that is the point.

## Commands

Two groups mirror the two ideas — who this machine is, and whether it is
connected:

```
microteams auth login [server-url]   log this machine in (device flow); first login names it
microteams auth logout               forget the credential (disconnects first)
microteams devicename <name>         rename this machine

microteams link connect              connect (runs login first if needed)
microteams link disconnect           disconnect (warns if screens are running)
microteams link status               login, connection and screen count at a glance
microteams link auto-connect         connect now and reconnect on every boot
microteams link no-auto-connect      disconnect and stop reconnecting on boot

microteams api <operation> [args]    the server's full request/response API
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
works, and a machine with a quirky one is never at its mercy. Sockets live in a
private per-run directory either way.

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

## The consumer

This monorepo's **backend** (`../backend`, the `mt` service) is the server that
drives this host: `agent/driver` picks a screen applet (`claude.js`) to run Claude
Code in a screen, and `agent/AppletController` serves the CLI applet (`cli.js`) that
defines `microteams api`. Both applets are authored in `../applets`. Nothing in
`internal/` knows any of that is about AI — read the host code and you cannot tell
what it hosts, which is the point.
