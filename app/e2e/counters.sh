#!/usr/bin/env bash
# What the multipath server holds, against what it held before any client came: every session,
# link, stream and target connection is released once the clients have left, and its goroutines
# are back to the count it started with.
#
# Usage:
#   counters.sh baseline   record the server's counters now (no client may be connected yet)
#   counters.sh settled    wait up to 15 s for sessions, links, streams and targets to be 0 and the
#                          goroutines to be at most the baseline's; print both, fail if they are not
#
# The stack must be up (stack.sh). The baseline is kept in $RUNNER_TEMP or /tmp.
set -euo pipefail
FILE="${RUNNER_TEMP:-/tmp}/e2e-multipath-baseline.json"
now() { docker exec e2e-multipath-1 wget -qO- http://127.0.0.1:9101/; }
field() { python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }

case "${1:-}" in
baseline)
  now > "$FILE"
  echo "multipath server at rest: $(cat "$FILE")"
  ;;
settled)
  base="$(field goroutines < "$FILE")"
  for _ in $(seq 1 30); do
    cur="$(now)"
    if python3 -c "
import json,sys
c=json.loads(sys.argv[1])
sys.exit(0 if c['sessions']==0 and c['links']==0 and c['streams']==0 and c['targets']==0 and c['goroutines']<=int(sys.argv[2]) else 1)
" "$cur" "$base"; then
      echo "multipath server after the clients left: $cur (at rest: $(cat "$FILE"))"
      exit 0
    fi
    sleep 0.5
  done
  echo "FAIL: the multipath server still holds resources after the clients left: $cur (at rest: $(cat "$FILE"))" >&2
  exit 1
  ;;
*) echo "usage: counters.sh baseline | settled" >&2; exit 2 ;;
esac
