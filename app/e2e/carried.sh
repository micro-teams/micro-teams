#!/usr/bin/env bash
# Did the journey's requests go over the substrate? The origin terminates the lines and splices each
# exchange into nginx, so a request that rode a line reaches nginx from the origin's address; one
# sent directly reaches it from anywhere else. A client that cannot dial a line sends its requests
# directly, which works — so every step of a journey passes with the substrate doing nothing, and
# only this asks.
#
# Usage: carried.sh [at least]   — fails unless nginx served at least that many /mt/ and /api/
#                                  requests from the origin (default 20), and unless the app's two
#                                  WebSockets — the updates socket and a live screen — were each
#                                  opened over the substrate and never directly (the machine's own
#                                  connector, which is not the app, is left out); prints the counts
#
# The stack must be up (stack.sh), as project e2e.
set -euo pipefail
WANT="${1:-20}"
ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1" 2>/dev/null || true; }
ORIGIN_IP="$(ip e2e-origin-1)" MACHINE_IP="$(ip e2e-machine)"
LOG="$(docker logs e2e-nginx-1 2>/dev/null)"
CARRIED="$(grep -c "^$ORIGIN_IP .*\"[A-Z]* /\(mt\|api\)/" <<<"$LOG" || true)"
echo "$CARRIED requests reached nginx over the substrate (from the origin, $ORIGIN_IP)"
[ "$CARRIED" -ge "$WANT" ] || { echo "FAIL: fewer than $WANT: the client is not using the substrate" >&2; exit 1; }
for socket in /mt/updates /mt/machine/screen/; do
  over="$(grep -c "^$ORIGIN_IP .*\"GET $socket" <<<"$LOG" || true)"
  direct="$(grep "\"GET $socket" <<<"$LOG" | grep -v "^$ORIGIN_IP " | { [ -n "$MACHINE_IP" ] && grep -v "^$MACHINE_IP " || cat; } | grep -c . || true)"
  echo "$socket: $over over the substrate, $direct directly"
  [ "$over" -ge 1 ] && [ "$direct" = 0 ] || { echo "FAIL: $socket was not opened over the substrate alone" >&2; exit 1; }
done
