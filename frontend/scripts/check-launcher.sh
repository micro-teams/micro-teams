#!/usr/bin/env bash
#
#  Description: Runs the browser checks against both deployments: the one line we have, and the two
#               lines we are about to have.
#
#               The second scenario is not hypothetical padding. The launcher behaves differently
#               with two lines — it races the entry module across both origins and imports it from
#               the winner — and that path found a real bug the moment it was pointed at a plain
#               static file server: the race asked for credentials, which CORS refuses to answer
#               with a wildcard, so it failed on every line but the one the page came from. Nothing
#               short of a browser in front of two origins would have said so.
#
#               One script rather than steps in a workflow, so that running it locally is the same
#               thing CI runs.
#
#  Author(s):
#      agent3
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(dirname "$HERE")"
DIST="$FRONTEND/dist"
TWO_LINE="${TMPDIR:-/tmp}/microteams-launcher-two-line"

ONE=8931
A=8941
B=8942

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

serve() { # port, directory
  PORT="$1" node "$HERE/static-server.mjs" "$2" >/dev/null 2>&1 &
  pids+=("$!")
  for _ in $(seq 1 30); do
    curl -sf --noproxy '*' "http://127.0.0.1:$1/" >/dev/null && return 0
    sleep 1
  done
  echo "server on $1 never came up" >&2
  return 1
}

echo "== one line (what production runs today)"
serve "$ONE" "$DIST"
LAUNCHER_CHECK_BASE="http://127.0.0.1:$ONE" npm run --silent check:launcher

echo
echo "== two lines (what production runs the day a second one is added)"
rm -rf "$TWO_LINE"
cp -r "$DIST" "$TWO_LINE"
node -e "
import('$HERE/launcher.mjs').then(async (m) => {
  await m.build('$TWO_LINE', { registry: { lines: [
    { id: 'a', url: 'http://127.0.0.1:$A', transport: 'test', weight: 100 },
    { id: 'b', url: 'http://127.0.0.1:$B', transport: 'test', weight: 90 },
  ] } });
});
"
serve "$A" "$TWO_LINE"
serve "$B" "$TWO_LINE"
LAUNCHER_CHECK_BASE="http://127.0.0.1:$A" LAUNCHER_CHECK_SECOND_BASE="http://127.0.0.1:$B" \
  npm run --silent check:launcher
