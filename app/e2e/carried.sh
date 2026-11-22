#!/usr/bin/env bash
# Did the journey's requests go over the lines? The multipath server terminates every line and
# splices each stream into nginx, so a request that rode a line reaches nginx from the multipath
# server's address; one sent directly reaches it from anywhere else. A client that cannot bring a
# session up sends its requests directly, which works — so every step of a journey passes with the
# lines doing nothing, and only this asks.
#
# Usage: carried.sh [at least]   — fails unless nginx served at least that many /mt/ and /api/
#                                  requests from the multipath server (default 10: reads ride the
#                                  one live socket, so what nginx counts is mostly writes and
#                                  pictures); unless the
#                                  app's two WebSockets — the live socket and a live screen —
#                                  were each opened over the lines and never directly (a viewer
#                                  the journey opens from outside the app, named by its User-Agent,
#                                  is not the app's); and, with a
#                                  machine (machine.sh), unless its control link was only ever
#                                  opened over its multipath client, and a short command
#                                  (`microteams api`) run now goes over it too; prints the counts
#
# The stack must be up (stack.sh), as project e2e.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WANT="${1:-10}"
ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1" 2>/dev/null || true; }
MP_IP="$(ip e2e-multipath-1)" MACHINE_IP="$(ip e2e-machine)"
LOG="$(docker logs e2e-nginx-1 2>/dev/null)"
CARRIED="$(grep -c "^$MP_IP .*\"[A-Z]* /\(mt\|api\)/" <<<"$LOG" || true)"
echo "$CARRIED requests reached nginx over the lines (from the multipath server, $MP_IP)"
[ "$CARRIED" -ge "$WANT" ] || { echo "FAIL: fewer than $WANT: the client is not using the lines" >&2; exit 1; }
for socket in /mt/live /mt/machine/screen/; do
  over="$(grep -c "^$MP_IP .*\"GET $socket" <<<"$LOG" || true)"
  # The journey's second viewer of a live screen is another client, outside the app, and says so.
  direct="$(grep "\"GET $socket" <<<"$LOG" | grep -v 'ua="e2e-outside-viewer"' | grep -vc "^$MP_IP " || true)"
  echo "$socket: $over over the lines, $direct directly"
  [ "$over" -ge 1 ] && [ "$direct" = 0 ] || { echo "FAIL: $socket was not opened over the lines alone" >&2; exit 1; }
done

[ -n "$MACHINE_IP" ] || exit 0
over="$(grep -c "^$MP_IP .*\"GET /mt/machine/link" <<<"$LOG" || true)"
direct="$(grep -c "^$MACHINE_IP .*\"GET /mt/machine/link" <<<"$LOG" || true)"
echo "the machine's control link: $over over its multipath client, $direct directly"
[ "$over" -ge 1 ] && [ "$direct" = 0 ] || { echo "FAIL: the control link was not opened over the multipath client alone" >&2; exit 1; }
before="$(grep -c "^$MP_IP .*\"GET /mt/agent/cli-applet" <<<"$LOG" || true)"
said="$(bash "$HERE/machine.sh" api)"
after="$(docker logs e2e-nginx-1 2>/dev/null | grep -c "^$MP_IP .*\"GET /mt/agent/cli-applet" || true)"
echo "a short command on the machine: $((after - before)) request(s) over the multipath client${said:+; it said: $said}"
[ "$after" -gt "$before" ] && ! grep -q "directly" <<<"$said" || { echo "FAIL: the short command did not go over the multipath client" >&2; exit 1; }
