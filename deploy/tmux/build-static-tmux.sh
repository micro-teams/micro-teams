#!/usr/bin/env bash
# Build a fully static tmux and drop it in the connector serving layout, so install.sh can hand every
# Linux machine a self-contained tmux (no libevent/ncurses needed on the target). Only the build
# recipe lives in git — never the binary.
#
# Usage:
#   deploy/tmux/build-static-tmux.sh [--arch amd64|arm64] [--out DIR] [--version 3.5a]
#
#   --arch     target arch (default: amd64). arm64 needs docker buildx + qemu binfmt.
#   --out      artifact root; the binary lands at <out>/linux-<arch>/tmux (Go-style arch, matching
#              install.sh's target and the backend's connector-binaries-dir layout).
#              default: $CONNECTOR_DIST_DIR, else <repo>/.connector-dist
#   --version  tmux release to build (default: 3.5a)
#
# macOS is deliberately not built here: static libc does not exist on Darwin, so install.sh falls
# back to copying the machine's own tmux for darwin targets.
set -euo pipefail

arch="amd64"
version="3.5a"
out=""

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)    arch="$2"; shift 2 ;;
    --out)     out="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"

if [ -z "$out" ]; then
  out="${CONNECTOR_DIST_DIR:-$repo_root/.connector-dist}"
fi

case "$arch" in
  amd64) platform="linux/amd64" ;;
  arm64) platform="linux/arm64" ;;
  *) echo "unsupported arch: $arch (amd64|arm64)" >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

dest_dir="$out/linux-$arch"
mkdir -p "$dest_dir"

# Build the `export` stage (FROM scratch, holding just /tmux) and write its contents straight to the
# host with buildx's local output — no container to create (a scratch image has no runnable command
# to `docker create`).
echo "[tmux] building static tmux $version for linux-$arch ($platform) ..."
docker build \
  --platform "$platform" \
  --build-arg "TMUX_VERSION=$version" \
  --target export \
  --output "type=local,dest=$dest_dir" \
  "$here"
chmod 0755 "$dest_dir/tmux"

echo "[tmux] wrote $dest_dir/tmux"
if command -v ldd >/dev/null 2>&1 && [ "$arch" = "amd64" ]; then
  echo -n "[tmux] linkage: "; ldd "$dest_dir/tmux" 2>&1 | sed 's/^/         /' || true
fi
file "$dest_dir/tmux" 2>/dev/null | sed 's/^/[tmux] /' || true
echo "[tmux] done."
