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
#
# <leg> is what plays the agent's program, as in .github/scripts/agent-leg.sh: `npm:<version>` (the
# pinned Claude Code), `installer` (its latest) or `pi:<version>`.
#
# The stack must be up (stack.sh): the machine joins its network and reaches it as http://nginx.
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
  wait_for_mock
  ENROLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST http://nginx/mt/machine/enroll/start \
    -H 'Content-Type: application/json' -d '{"name":"e2e-machine"}')"
  CODE="$(printf '%s' "$ENROLL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
  [ -n "$CODE" ] || fail "enrolment start returned no code: $ENROLL"
  # The machine's own half of enrolment: poll until a person approves, write the config, and run
  # the connector. `or ""`, because a pending poll answers with the keys present and null.
  docker exec -d "$MACHINE_CT" bash -c "
    for _ in \$(seq 1 1200); do
      OUT=\$(curl -fsS -X POST http://nginx/mt/machine/enroll/poll -H 'Content-Type: application/json' \
        -d '{\"code\":\"$CODE\"}' || true)
      TOKEN=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"token\") or \"\")' 2>/dev/null || true)
      MID=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"machineId\") or \"\")' 2>/dev/null || true)
      if [ -n \"\$TOKEN\" ]; then
        printf '{\"base\":\"http://nginx/mt\",\"token\":\"%s\",\"machine_id\":\"%s\"}' \"\$TOKEN\" \"\$MID\" \
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
*) echo "usage: machine.sh up <bundle> <leg> | saw <leg> <text> | logs" >&2; exit 2 ;;
esac
