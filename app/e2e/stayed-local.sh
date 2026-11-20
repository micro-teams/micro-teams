#!/usr/bin/env bash
# Did the Android app talk to the stack under test and nothing else? A client that dials another
# deployment's lines (the default server's, before the journey points it at the stack) works just
# as well, so no step of the journey fails; only its log says which lines it dialled. The app logs
# every line it dials by id ("multipath: session <id> line <line>: ..."), and every id must be one of
# the stack's own.
#
# Usage: stayed-local.sh <lines.json>   — the stack's line list (stack.sh writes it); reads the
#                                         emulator's log with adb, prints the line ids it found,
#                                         fails on any id the list does not have
set -euo pipefail
LIST="$1"
OURS="$(python3 -c 'import json,sys; print("\n".join(l["id"] for l in json.load(open(sys.argv[1]))["lines"]))' "$LIST" | sort -u)"
SEEN="$(adb logcat -d -s ReactNativeJS:V | grep -o "multipath: session [0-9a-f]* line [^:]*" | awk '{print $5}' | sort -u || true)"
echo "lines the app dialled: ${SEEN:-none logged}"
FOREIGN="$(comm -13 <(echo "$OURS") <(echo "$SEEN") | grep . || true)"
[ -z "$FOREIGN" ] || { echo "FAIL: the app dialled lines that are not the stack's: $FOREIGN" >&2; exit 1; }
