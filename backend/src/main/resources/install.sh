#!/bin/sh
# install.sh — one-line installer for the `microteams` connector, served by the backend.
#
#   curl -fsSL <origin>/install.sh | sh
#
# Downloads the right prebuilt `microteams` binary — and a private, static tmux — from
# the same origin it was fetched from, so a fresh machine needs nothing pre-installed.
# It carries NO secrets and NO business logic: it only drops a binary and records the
# server URL. Enrollment still happens through the device flow (`microteams link
# auto-connect` → approve in the browser), so piping this to a shell never grants
# access by itself.
#
# Recommended: run as a NORMAL user — `curl … | sh`, no sudo. The binary goes in your
# ~/.local/bin and config/tmux in your home, and the next step, `microteams link
# auto-connect`, installs a boot service that runs *as you* (User=<you>), so the
# connector — and every agent it launches — runs under your account.
#
# Do NOT run the connector as root. Claude Code refuses `--dangerously-skip-permissions`
# under root, so an agent launched by a root connector hangs. `| sudo sh` is fine for the
# install itself (binary → /usr/local/bin, config stays in your home, and the service
# still runs as the invoking user) — but don't install from a root login shell, which
# would make the service run as root and break agents.
#
# The backend bakes three values when it serves this file:
#   __CONNECTOR_BASE__ — the origin root the binaries hang off (<origin>, the
#                        artifacts live at <origin>/connector/latest/<target>/…);
#   __API_BASE__       — the request/response API base the cli dials (<origin>/mt);
#   __WS_BASE__        — an optional control-channel override (usually empty).
# Override any of them with MICROTEAMS_CONNECTOR_BASE / MICROTEAMS_API_BASE /
# MICROTEAMS_WS_BASE if needed.
set -eu

CONNECTOR_BASE="${MICROTEAMS_CONNECTOR_BASE:-__CONNECTOR_BASE__}"
API_BASE="${MICROTEAMS_API_BASE:-__API_BASE__}"
WS_ORIGIN="${MICROTEAMS_WS_BASE:-__WS_BASE__}"

# --- pretty output -----------------------------------------------------------
if [ -t 1 ]; then B='\033[1m'; DIM='\033[2m'; M='\033[1;35m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; Z='\033[0m'; else B=''; DIM=''; M=''; G=''; Y=''; R=''; Z=''; fi
step() { printf "${M}▸${Z} %s\n" "$*"; }
ok()   { printf "  ${G}✓${Z} %s\n" "$*"; }
warn() { printf "  ${Y}!${Z} %s\n" "$*"; }
die()  { printf "${R}✗ %s${Z}\n" "$*" >&2; exit 1; }

printf "\n${B}microteams connector${Z} ${DIM}· installer${Z}\n\n"

# --- privilege + install locations ------------------------------------------
# Config + the private tmux always live in the *invoking* user's home and are owned by
# them, because `microteams link auto-connect` installs a system service that runs as
# that user (User=…) and must read them. The binary goes on PATH. Works `| sh` or
# `| sudo sh`.
if [ "$(id -u)" = 0 ]; then
  BIN_DIR="/usr/local/bin"                       # on every PATH, incl. sudo's secure_path
  owner="${SUDO_USER:-root}"
  home="$(getent passwd "$owner" 2>/dev/null | cut -d: -f6)"; [ -n "$home" ] || home="$HOME"
else
  BIN_DIR="$HOME/.local/bin"
  owner="$(id -un)"; home="$HOME"
fi
CFG_DIR="$home/.config/microteams"
CFG="$CFG_DIR/config.json"

# --- pick a downloader -------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  die "need curl or wget to download the microteams binary"
fi

# --- detect os/arch ----------------------------------------------------------
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux)  os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported OS: $os (microteams runs on Linux and macOS)" ;;
esac
case "$arch" in
  x86_64|amd64)  arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "unsupported arch: $arch (microteams ships amd64 and arm64)" ;;
esac
target="$os-$arch"
step "Platform"
ok "$target"

# --- 1. microteams binary ----------------------------------------------------
step "Installing microteams"
mkdir -p "$BIN_DIR"
tmp="$(mktemp)"
dl "$CONNECTOR_BASE/connector/latest/$target/microteams" "$tmp" \
  || die "could not download $CONNECTOR_BASE/connector/latest/$target/microteams"
install -m 0755 "$tmp" "$BIN_DIR/microteams"; rm -f "$tmp"
ok "$BIN_DIR/microteams"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    # Not on PATH — give the exact copy-paste line, targeting the login shell's rc file so the
    # command actually sticks (zsh users editing ~/.bashrc is a classic dead end).
    case "${SHELL##*/}" in
      zsh)  rc="$HOME/.zshrc" ;;
      fish) rc="$HOME/.config/fish/config.fish" ;;
      *)    rc="$HOME/.bashrc" ;;
    esac
    warn "$BIN_DIR is not on your PATH. To fix it, run:"
    if [ "${SHELL##*/}" = fish ]; then
      printf '\n    fish_add_path %s\n\n' "$BIN_DIR" >&2
    else
      printf '\n    echo '\''export PATH="%s:$PATH"'\'' >> %s && . %s\n\n' "$BIN_DIR" "$rc" "$rc" >&2
    fi
    ;;
esac

# --- 2. private tmux ---------------------------------------------------------
# microteams runs its screens in a private tmux so it never fights the machine's own.
# Resolution order: (1) copy the machine's own tmux if it has one — the surest match
# for the OS; (2) else download the static build the origin publishes (no
# libevent/ncurses needed on the target); (3) else tell the user to install tmux
# themselves after setup. macOS gets its tmux here, since only Linux tmux is published.
step "Installing private tmux"
mkdir -p "$CFG_DIR/bin"
if command -v tmux >/dev/null 2>&1; then
  install -m 0755 "$(command -v tmux)" "$CFG_DIR/bin/tmux"
  ok "copied this machine's tmux ($(command -v tmux))"
else
  tmp="$(mktemp)"
  if dl "$CONNECTOR_BASE/connector/latest/$target/tmux" "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
    install -m 0755 "$tmp" "$CFG_DIR/bin/tmux"
    ok "downloaded static tmux → $CFG_DIR/bin/tmux"
  else
    warn "no tmux on this machine and none could be downloaded for $target."
    warn "please install tmux after setup (e.g. apt/dnf/brew install tmux);"
    warn "sessions won't start until a tmux is on PATH or at $CFG_DIR/bin/tmux."
  fi
  rm -f "$tmp"
fi

# --- 3. git (for document trees) ---------------------------------------------
# Agents work a team's document tree by running `git` on this machine. git is not needed
# to install or enroll the connector, and non-document screens work fine without it, so a
# missing git is a warning — not a failure.
step "Checking for git"
if command -v git >/dev/null 2>&1; then
  ok "$(command -v git)"
else
  warn "git is not on PATH — the connector installs fine and non-document screens work,"
  warn "but agents can't use team documents until git is present."
  warn "please install git (e.g. apt/dnf/brew install git)."
fi

# --- 4. remember the server --------------------------------------------------
# Two separate endpoints, matching the two things this machine does:
#   - "base" — login (device flow) and the request/response API. Always the friendly
#     API base (<origin>/mt), the same endpoint the human approves devices on.
#   - "ws"   — the persistent control channel `microteams run` dials out on. Empty (the
#     default) leaves that derivation to the cli, which turns "base" into a ws(s):// …
#     /agent URL itself. A deployment whose edge strips the WebSocket Upgrade header can
#     bake __WS_BASE__ (a plain http(s) origin) to point just this channel at a
#     WS-capable endpoint, leaving login/API/binary-downloads untouched; this script does
#     the same http(s)->ws(s) + /agent derivation the cli would have done.
# MICROTEAMS_WS_BASE overrides it manually (also a plain origin).
ws=""
if [ -n "$WS_ORIGIN" ]; then
  case "$WS_ORIGIN" in
    https://*) ws="wss://${WS_ORIGIN#https://}" ;;
    http://*)  ws="ws://${WS_ORIGIN#http://}" ;;
    *)         ws="$WS_ORIGIN" ;;  # already ws(s):// (or unrecognized) — use as-is
  esac
  ws="${ws%/}/agent"
fi
mkdir -p "$CFG_DIR"
if [ -f "$CFG" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$CFG" "$API_BASE" "$ws" <<'PY'
import json, sys
path, base, ws = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    cfg = json.load(open(path))
except Exception:
    cfg = {}
cfg["base"] = base
if ws:
    cfg["ws"] = ws
else:
    cfg.pop("ws", None)
json.dump(cfg, open(path, "w"), indent=2)
PY
else
  if [ -n "$ws" ]; then
    printf '{\n  "base": "%s",\n  "ws": "%s"\n}\n' "$API_BASE" "$ws" > "$CFG"
  else
    printf '{\n  "base": "%s"\n}\n' "$API_BASE" > "$CFG"
  fi
  chmod 600 "$CFG"
fi
step "Server"
ok "$API_BASE"
if [ -n "$ws" ]; then
  ok "control channel: $ws"
fi

# When installed via sudo, hand the config dir back to the user the service will run as.
if [ "$(id -u)" = 0 ] && [ "$owner" != "root" ]; then
  chown -R "$owner" "$CFG_DIR" 2>/dev/null || true
fi

# --- 5. what now? ------------------------------------------------------------
# One command connects: it logs this machine in (approve in the browser) and installs
# the boot service — elevating to root for a system-wide service if needed.
printf "\n${G}Installed.${Z} One more command to go online:\n\n"
printf "    ${B}microteams link auto-connect${Z}\n\n"
printf "${DIM}It prints an approve link — open it while logged in to bind this machine.\n"
printf "Manage later:  microteams status · microteams link connect · microteams uninstall${Z}\n\n"
