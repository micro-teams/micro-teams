#!/usr/bin/env bash
# Did the journey's requests go over the substrate? The origin terminates the lines and splices each
# exchange into nginx, so a request that rode a line reaches nginx from the origin's address; one
# sent directly reaches it from anywhere else. A client that cannot dial a line sends its requests
# directly, which works — so every step of a journey passes with the substrate doing nothing, and
# only this asks.
#
# Usage: carried.sh [at least]   — fails unless nginx served at least that many /mt/ and /api/
#                                  requests from the origin (default 20); prints the count
#
# The stack must be up (stack.sh), as project e2e.
set -euo pipefail
WANT="${1:-20}"
ORIGIN_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-origin-1)"
CARRIED="$(docker logs e2e-nginx-1 2>/dev/null | grep -c "^$ORIGIN_IP .*\"[A-Z]* /\(mt\|api\)/" || true)"
echo "$CARRIED requests reached nginx over the substrate (from the origin, $ORIGIN_IP)"
[ "$CARRIED" -ge "$WANT" ] || { echo "FAIL: fewer than $WANT: the client is not using the substrate" >&2; exit 1; }
