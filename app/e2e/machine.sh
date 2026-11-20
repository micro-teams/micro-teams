#!/usr/bin/env bash
# A customer's machine for a journey: a plain Debian container with the connector and tmux taken
# from the bundle — the files the backend serves to a real machine, so a broken binary in the bundle
# fails here — and a real agent program on it in front of a mock model API.
#
# Usage:
#   machine.sh up <bundle> <leg>   start enrolment, print the code to approve on the last line, and
#                                  leave the machine polling for its token; once approved it runs
#                                  the connector as its boot service would
#   machine.sh saw <leg> <text>    wait up to two minutes for the model on the machine to have been
#                                  given text, and fail if it never was
#   machine.sh logs                what the connector said
#   machine.sh session             the id of the machine's live MultiPath session (its client's
#                                  /status, found through the state file), or nothing
#   machine.sh api                 run a short command (`microteams api`) on the machine and print
#                                  what it said on stderr
#   machine.sh stop                stop the connector the way its service manager would (SIGTERM)
#
# <leg> is what plays the agent's program, as in .github/scripts/agent-leg.sh: `npm:<version>` (the
# pinned Claude Code), `installer` (its latest) or `pi:<version>`.
#
# The stack must be up (stack.sh): the machine joins its network, and forwarders on the machine
# (lines.py) make localhost:80, :8081 and :8082 the stack's three lines, so the machine reaches the
# stack as http://localhost, under the same names as every other client. The connector is copied
# without the multipath client, which it downloads from the stack when it starts, as a machine that
# updated from a connector without one does.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACHINE_CT=e2e-machine MOCK_CT=e2e-mock MACHINE_USER=agent
fail() { echo "FAIL: $1" >&2; exit 1; }
onmachine() { docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -lc "$1"; }
# shellcheck source=../../.github/scripts/agent-leg.sh
. "$HERE/../../.github/scripts/agent-leg.sh"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' e2e-nginx-1)"

case "${1:-}" in
up)
  BUNDLE="$(cd "$2" && pwd)" LEG="$3"
  docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true
  # On docker's default network while installing: a deployment's network owes nobody the internet.
  docker run -d --name "$MACHINE_CT" --hostname "$MACHINE_CT" debian:13 sleep infinity >/dev/null
  docker exec "$MACHINE_CT" bash -c "set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq ca-certificates curl procps python3 git >/dev/null
    useradd -m -s /bin/bash $MACHINE_USER
    mkdir -p /home/$MACHINE_USER/.local/bin /home/$MACHINE_USER/.config/microteams/bin"
  docker cp "$BUNDLE/connector/linux-amd64/microteams" "$MACHINE_CT:/home/$MACHINE_USER/.local/bin/microteams"
  docker cp "$BUNDLE/connector/linux-amd64/tmux" "$MACHINE_CT:/home/$MACHINE_USER/.config/microteams/bin/tmux"
  docker exec "$MACHINE_CT" bash -c "chmod +x /home/$MACHINE_USER/.local/bin/microteams \
    /home/$MACHINE_USER/.config/microteams/bin/tmux; chown -R $MACHINE_USER: /home/$MACHINE_USER"
  onmachine '$HOME/.local/bin/microteams --version' >/dev/null || fail "the bundled connector does not run"
  install_agent_program "$LEG" >&2
  docker network connect "$NET" "$MACHINE_CT"
  docker cp "$HERE/lines.py" "$MACHINE_CT:/lines.py"
  docker exec -d "$MACHINE_CT" python3 /lines.py --line 80=nginx:80 --line 8081=e2e-lines:8081 --line 8082=e2e-lines:8082
  for _ in $(seq 1 20); do docker exec "$MACHINE_CT" curl -fsS -o /dev/null http://localhost/multipath/v3/lines && break; sleep 0.5; done
  wait_for_mock
  ENROLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST http://localhost/mt/machine/enroll/start \
    -H 'Content-Type: application/json' -d '{"name":"e2e-machine"}')"
  CODE="$(printf '%s' "$ENROLL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
  [ -n "$CODE" ] || fail "enrolment start returned no code: $ENROLL"
  # The machine's own half of enrolment: poll until a person approves, write the config, and run
  # the connector. `or ""`, because a pending poll answers with the keys present and null.
  docker exec -d "$MACHINE_CT" bash -c "
    for _ in \$(seq 1 1200); do
      OUT=\$(curl -fsS -X POST http://localhost/mt/machine/enroll/poll -H 'Content-Type: application/json' \
        -d '{\"code\":\"$CODE\"}' || true)
      TOKEN=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"token\") or \"\")' 2>/dev/null || true)
      MID=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"machineId\") or \"\")' 2>/dev/null || true)
      if [ -n \"\$TOKEN\" ]; then
        printf '{\"base\":\"http://localhost/mt\",\"token\":\"%s\",\"machine_id\":\"%s\"}' \"\$TOKEN\" \"\$MID\" \
          > /home/$MACHINE_USER/.config/microteams/config.json
        chown $MACHINE_USER: /home/$MACHINE_USER/.config/microteams/config.json
        su - $MACHINE_USER -c '\$HOME/.local/bin/microteams run --config \$HOME/.config/microteams/config.json' \
          > /tmp/connector.log 2>&1
        exit 0
      fi
      sleep 2
    done"
  echo "$CODE"
  ;;
saw)
  LEG="$2" TEXT="$3"
  for _ in $(seq 1 60); do
    case "$LEG" in pi:*) SAW="$(verify_model_saw_pi "$TEXT")" ;; *) SAW="$(verify_model_saw "$TEXT")" ;; esac
    [ "$SAW" = "202" ] && { echo "the model on the machine was given $TEXT"; exit 0; }
    sleep 2
  done
  fail "what was said in the app ($TEXT) never reached the model on the machine"
  ;;
logs)
  docker exec "$MACHINE_CT" tail -60 /tmp/connector.log 2>/dev/null || echo "(no connector log: it never started)"
  ;;
session)
  onmachine 'python3 -c "
import json, os, urllib.request
try:
    st = json.load(open(os.path.expanduser(\"~/.config/microteams/state.json\")))[\"multipathClient\"]
    s = json.load(urllib.request.urlopen(\"http://\" + st[\"status\"] + \"/status\", timeout=2))[\"session\"]
    print(s[\"id\"] if s and s[\"state\"] == \"live\" else \"\")
except Exception:
    print(\"\")
"'
  ;;
api)
  onmachine 'microteams api >/dev/null 2>/tmp/api.err; cat /tmp/api.err'
  ;;
stop)
  docker exec "$MACHINE_CT" pkill -TERM -f "microteams run" || true
  for _ in $(seq 1 20); do docker exec "$MACHINE_CT" pgrep -f "multipath-client|microteams run" >/dev/null || exit 0; sleep 0.5; done
  fail "the connector or its multipath client did not stop within 10 s"
  ;;
*) echo "usage: machine.sh up <bundle> <leg> | saw <leg> <text> | logs | session | api | stop" >&2; exit 2 ;;
esac
