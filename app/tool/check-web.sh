#!/usr/bin/env bash
#
#  Description: Serves the built web app and runs the browser checks against it.
#
#               One script rather than steps in a workflow, so running it locally is the same thing
#               CI runs. Expects `flutter build web --release` to have happened already.
#
#  Author(s):
#      Nictheboy Li    <nictheboy@outlook.com>
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(dirname "$HERE")"
DIST="$APP/build/web"
PORT="${CHECK_WEB_PORT:-8931}"

if [ ! -f "$DIST/index.html" ]; then
  echo "no build at $DIST — run: flutter build web --release" >&2
  exit 1
fi

server=""
cleanup() { [ -n "$server" ] && kill "$server" 2>/dev/null || true; }
trap cleanup EXIT

PORT="$PORT" node "$HERE/static-server.mjs" "$DIST" >/dev/null 2>&1 &
server=$!

for _ in $(seq 1 30); do
  # --noproxy: a proxy in the environment will happily intercept a loopback request and reset it,
  # which reads as "the server never came up". The same trap breaks `flutter test` (see README).
  curl -sf --noproxy '*' "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 1
done

CHECK_WEB_BASE="http://127.0.0.1:$PORT" node "$HERE/check-web.mjs"
