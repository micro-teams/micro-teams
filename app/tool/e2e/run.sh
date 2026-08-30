#!/usr/bin/env bash
#
# Run the end-to-end journey against a real deployment of the shipped bundle.
#
# This is the outside half of the suite described in todo/microteams/testing-e2e.md. It deploys the
# bundle exactly the way deploy/README.md tells a customer to, puts a gateway in front so the app
# and the server share one origin, and then starts one self-contained journey inside a real browser.
# It hands parameters in and collects a result; it never directs the test.
#
#   bash tool/e2e/run.sh --bundle <dir> [--journey full|no-machine] [--leg npm:<version>] [--keep]
#
# --bundle   an unpacked deployment bundle (the microteams-deploy artifact, or deploy/ with the
#            build outputs in place). Required: this suite tests what we ship, not a dev server.
# --journey  `full` (the default, and what CI runs) is the whole thing: sign up, work in the app,
#            bring a host in, put an agent on it, and afterwards assert that what was said in the
#            interface reached the program running there. `no-machine` runs the same script without
#            spinning a host — for iterating locally, never as a substitute for a real run.
#
#            There is deliberately no second journey. Coverage is meant to be a pairing of client
#            sides against machine environments — max(clients, environments) runs, each doing
#            everything — not one run per half, which would multiply as clients are added.
# --leg      what plays the agent's program on that host, same meaning as in .github/scripts/e2e.sh:
#            `npm:<version>` is the pinned real Claude Code, which is where determinism comes from;
#            `installer` is its latest, and drifts on purpose.
# --keep     leave the stack, the gateway and the mail sink running afterwards, to inspect a failure.
#
# Ports live in one block (52000–52099) so several agents can share the dev machine; override any of
# them with the environment variables below.
set -euo pipefail

BUNDLE=""
LEG="npm:2.1.220"
JOURNEY="full"
KEEP="${KEEP:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle)  BUNDLE="$2"; shift 2 ;;
    --leg)     LEG="$2"; shift 2 ;;
    --journey) JOURNEY="$2"; shift 2 ;;
    --keep)    KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BUNDLE" ] || { echo "--bundle <dir> is required" >&2; exit 2; }
BUNDLE="$(cd "$BUNDLE" && pwd)"
[ -f "$BUNDLE/docker-compose.yml" ] || { echo "$BUNDLE is not a deployment bundle" >&2; exit 2; }

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${MT_E2E_PROJECT:-mte2e}"
STACK_PORT="${MT_E2E_STACK_PORT:-52080}"
GATEWAY_PORT="${MT_E2E_GATEWAY_PORT:-52081}"
FLUTTER_PORT="${MT_E2E_FLUTTER_PORT:-52090}"
SMTP_PORT="${MT_E2E_SMTP_PORT:-52026}"
MAIL_PORT="${MT_E2E_MAIL_PORT:-52027}"
DRIVER_PORT="${MT_E2E_DRIVER_PORT:-52044}"
GATEWAY_CT="${PROJECT}-gateway"
MACHINE_CT="${PROJECT}-machine"
MOCK_CT="${PROJECT}-mock"
MACHINE_USER=agent
RUN_ID="$(date +%s)$$"

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; trace; exit 1; }

# Installing the agent's program and scripting what the model says back are shared with the
# machinery e2e: one copy, because it is the same paragraph either way.
# shellcheck source=../../../.github/scripts/agent-leg.sh
. "$APP/../.github/scripts/agent-leg.sh"
# What the journey itself said, in order. A release web build reports only the test's name when an
# expectation fails, so this is the only thing that says WHERE it stopped.
trace() {
  printf '\n--- what the journey was doing ---\n'
  curl -fsS "http://localhost:${MAIL_PORT:-52027}/notes" 2>/dev/null |
    python3 -c 'import sys,json;[print(" ",n) for n in json.load(sys.stdin)]' 2>/dev/null || true
}

# The service worker has to be out of the way while a journey runs, and the only place to say so is
# the page template the build uses. It precaches the SHIPPED shell (index.html, app.html, the
# launcher) and then serves that over whatever `flutter drive` built, so the app under test never
# finishes starting — and the symptom is silence, not an error. What the worker does belongs to the
# real build, and tool/check-web.mjs tests it there, in a real browser, against the real files.
INDEX="$APP/web/index.html"
INDEX_BACKUP="$APP/web/index.html.e2e-backup"
silence_service_worker() {
  # A killed run can leave the backup behind; restoring it first means a run always starts from the
  # committed file rather than from whatever the last crash left.
  [ -f "$INDEX_BACKUP" ] && mv "$INDEX_BACKUP" "$INDEX"
  cp "$INDEX" "$INDEX_BACKUP"
  sed -i 's#navigator.serviceWorker.register("/sw.js")#Promise.reject(new Error("service worker off for the e2e run"))#' "$INDEX"
}
restore_service_worker() {
  [ -f "$INDEX_BACKUP" ] && mv "$INDEX_BACKUP" "$INDEX" || true
}

MAILSINK_PID=""
CHROMEDRIVER_PID=""
cleanup() {
  restore_service_worker
  [ -n "$MAILSINK_PID" ] && kill "$MAILSINK_PID" 2>/dev/null || true
  [ -n "$CHROMEDRIVER_PID" ] && kill "$CHROMEDRIVER_PID" 2>/dev/null || true
  if [ "$KEEP" = "1" ]; then
    echo "(--keep: the stack, the gateway, the mail sink and any machine are still up; app on :$GATEWAY_PORT)"
    return
  fi
  docker rm -f "$GATEWAY_CT" "$MACHINE_CT" "$MOCK_CT" >/dev/null 2>&1 || true
  (cd "$BUNDLE" && docker compose -p "$PROJECT" down -v >/dev/null 2>&1) || true
}
trap cleanup EXIT

# --- nothing left over from last time -------------------------------------------------------------
# A killed run leaves a web server, a chromedriver, or a browser holding one of these ports, and the
# next run then talks to the WRONG one: the driver waits for a connection from an app that a stale
# server is serving, and the whole thing hangs with no error. Fail loudly instead, and clear what is
# ours to clear.
JOURNEY_TARGET=journey_test.dart
case "$JOURNEY" in
  full) ;;                    # the whole thing, machine and all — what CI runs
  no-machine) ;;              # the same script, minus the host: for iterating locally
  *) echo "unknown journey: $JOURNEY (want full or no-machine)" >&2; exit 2 ;;
esac

step "check the ports are free"
for port in "$STACK_PORT" "$GATEWAY_PORT" "$FLUTTER_PORT" "$SMTP_PORT" "$MAIL_PORT" "$DRIVER_PORT"; do
  holder="$(ss -ltnpH "sport = :$port" 2>/dev/null || true)"
  [ -z "$holder" ] && continue
  case "$port" in
    "$STACK_PORT"|"$GATEWAY_PORT") ;;   # the stack and the gateway are ours to reuse
    *) echo "port $port is already in use: $holder" >&2
       echo "(a previous run may not have cleaned up: kill it, or set MT_E2E_* to another block)" >&2
       exit 1 ;;
  esac
done

# --- the deployment ------------------------------------------------------------------------------
# gen-env.sh is the bundle's own script and is left to do its job; only what a test deployment must
# differ in is edited afterwards: the port (so runs can share a machine) and the SMTP relay (so the
# sign-up mail goes somewhere this run can read).
step "deploy the bundle"
cd "$BUNDLE"
if [ ! -f .env ]; then
  # A fresh .env means fresh secrets, and the database password is one of them — so any state left
  # by an earlier deployment has to go with it, or Postgres rejects the new password against the old
  # data directory (P1000, and cheese-auth never comes up). app_data/ is state, and a test
  # deployment's state is disposable by definition.
  # Written by the containers, so most of it is not ours to delete: the services run as their own
  # users. A throwaway container does the deleting, which needs no privileges here and works the same
  # on a laptop and on a CI runner.
  if [ -d app_data ] && ! rm -rf app_data 2>/dev/null; then
    docker run --rm -v "$PWD/app_data:/state" debian:13 rm -rf /state >/dev/null 2>&1 || true
    rm -rf app_data 2>/dev/null || true
  fi
  bash gen-env.sh >/dev/null
fi
# A placeholder host for the first boot: gen-env.sh leaves it blank, and cheese-auth will not come
# up healthy without something to parse. The address that actually works is only knowable once the
# compose network exists, so it is filled in below.
sed -i \
  -e "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=127.0.0.1/" \
  -e "s/^EMAIL_SMTP_PORT=.*/EMAIL_SMTP_PORT=$SMTP_PORT/" \
  -e "s|^EMAIL_DEFAULT_FROM=.*|EMAIL_DEFAULT_FROM=MicroTeams <no-reply@example.com>|" .env
grep -q '^NGINX_HTTP_PORT=' .env || echo "NGINX_HTTP_PORT=$STACK_PORT" >> .env
sed -i "s/^NGINX_HTTP_PORT=.*/NGINX_HTTP_PORT=$STACK_PORT/" .env
docker compose -p "$PROJECT" up -d --wait || fail "the bundle did not come up healthy"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$(docker compose -p "$PROJECT" ps -q nginx)")"

# The relay address has to be one the CONTAINERS can reach, and that is this network's own gateway —
# not the host's LAN address, which a container may have no route to (and which silently turns every
# sign-up into a 500 with "failed to send email"). The network only exists once compose has created
# it, so this is a second pass: write the address, then restart the one service that reads it.
SMTP_HOST="${MT_E2E_SMTP_HOST:-$(docker network inspect "$NET" \
  -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')}"
[ -n "$SMTP_HOST" ] || fail "could not work out an address the containers can reach us on"
sed -i "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=$SMTP_HOST/" .env
docker compose -p "$PROJECT" up -d --wait cheese-auth ||
  fail "cheese-auth did not come back up with the mail relay set"

# --- the mail sink -------------------------------------------------------------------------------
step "start the mail sink"
python3 "$APP/tool/e2e/mailsink.py" --smtp-port "$SMTP_PORT" --http-port "$MAIL_PORT" \
  >/tmp/mte2e-mailsink.log 2>&1 &
MAILSINK_PID=$!
for _ in $(seq 1 20); do
  curl -fsS "http://localhost:$MAIL_PORT/messages" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -X DELETE "http://localhost:$MAIL_PORT/messages" >/dev/null

# --- one origin ----------------------------------------------------------------------------------
step "put a gateway in front"
docker rm -f "$GATEWAY_CT" >/dev/null 2>&1 || true
docker run -d --name "$GATEWAY_CT" --network "$NET" \
  --add-host host.docker.internal:host-gateway \
  -e "FLUTTER_PORT=$FLUTTER_PORT" -e "MAIL_PORT=$MAIL_PORT" \
  -p "$GATEWAY_PORT:80" \
  -v "$APP/tool/e2e/gateway.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  -v "$APP/tool/e2e/e2e-proxy.inc:/etc/nginx/e2e-proxy.inc:ro" \
  nginx:1.27-alpine >/dev/null
for _ in $(seq 1 30); do
  # 502 is the expected answer until flutter's server exists; anything at all means nginx is up.
  curl -s -o /dev/null "http://localhost:$GATEWAY_PORT/" && break
  sleep 1
done
curl -fsS "http://localhost:$GATEWAY_PORT/mt/lines" >/dev/null 2>&1 ||
  fail "the gateway cannot reach the deployment"

# --- the browser ---------------------------------------------------------------------------------
step "start chromedriver"
command -v chromedriver >/dev/null || fail "chromedriver is not installed"
chromedriver --port="$DRIVER_PORT" >/tmp/mte2e-chromedriver.log 2>&1 &
CHROMEDRIVER_PID=$!
sleep 2

# --- the journey ---------------------------------------------------------------------------------
# The browser is pointed at the gateway, not at flutter's own server, so the app is same-origin with
# the deployment. Everything else the journey needs it is told once, here, and then it is on its own.
# A debug build, and not by preference — release was tried and cannot type. In a release web build
# neither `tester.enterText` nor the test text input reaches a field: the text never arrives, the
# submit button never enables, and the journey waits for something that cannot happen. Debug has a
# cost of its own (dwds sometimes never hands the browser to the test, silently), and that is what
# the retry below is for: it tells that failure apart from a real one by whether the journey said
# anything at all.
#
# The browser is put on the gateway's origin by test_driver/integration_test.dart rather than by
# `--web-launch-url`. One origin is not negotiable: cross-origin was tried, and the backend refuses
# a cross-origin /mt/lines — which is the product being right rather than something to work around.
# --- the machine, when the journey needs one -------------------------------------------------------
# Lifted from .github/scripts/e2e.sh, which has been doing this for a year: a plain Debian container
# standing in for a customer's host, with the connector and tmux taken FROM THE BUNDLE — the same
# files the backend serves to a real machine, so a broken binary in the bundle fails here.
#
# What is different is who approves it. There, curl did; here the enrolment is started on the machine
# and the CODE is handed to the journey, which approves it through the interface the way a person
# reading it off their own terminal would.
TARGET_DEFINES=""
if [ "$JOURNEY" = "full" ]; then
  step "spin a host and install the connector from the bundle (leg: $LEG)"
  docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true
  docker run -d --name "$MACHINE_CT" --hostname "$MACHINE_CT" --network "$NET" \
    debian:13 sleep infinity >/dev/null
  docker exec "$MACHINE_CT" bash -c "set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq ca-certificates curl procps python3 >/dev/null
    useradd -m -s /bin/bash $MACHINE_USER
    mkdir -p /home/$MACHINE_USER/.local/bin /home/$MACHINE_USER/.config/microteams/bin"
  docker cp "$BUNDLE/connector/linux-amd64/microteams" \
    "$MACHINE_CT:/home/$MACHINE_USER/.local/bin/microteams"
  docker cp "$BUNDLE/connector/linux-amd64/tmux" \
    "$MACHINE_CT:/home/$MACHINE_USER/.config/microteams/bin/tmux"
  docker exec "$MACHINE_CT" bash -c "chmod +x /home/$MACHINE_USER/.local/bin/microteams \
    /home/$MACHINE_USER/.config/microteams/bin/tmux; chown -R $MACHINE_USER: /home/$MACHINE_USER"
  docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -lc '$HOME/.local/bin/microteams --version' \
    >/dev/null || fail "the bundled connector does not run"

  # The agent's program: the real Claude Code, in front of a mock Anthropic API. Shared with the
  # machinery e2e — see .github/scripts/agent-leg.sh for why there is one copy of this.
  onmachine() { docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -lc "$1"; }
  install_agent_program "$LEG"
  wait_for_mock

  step "start enrolment on the machine and hand the code to the journey"
  ENROLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST "http://nginx/mt/machine/enroll/start" \
    -H 'Content-Type: application/json' -d '{"name":"e2e-machine"}')"
  CODE="$(printf '%s' "$ENROLL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
  [ -n "$CODE" ] || fail "enrolment start returned no code: $ENROLL"
  TARGET_DEFINES="--dart-define=MT_E2E_ENROLL_CODE=$CODE"

  # The machine's own half of enrolment, waiting for the human to approve in the interface: poll
  # until a token comes back, write the config, and run the connector the way its boot service would
  # (a container has no init to install one into). This is the only thing that happens in parallel
  # with the journey, and it is the machine's own behaviour, not direction from outside.
  docker exec -d "$MACHINE_CT" bash -c "
    for _ in \$(seq 1 120); do
      OUT=\$(curl -fsS -X POST http://nginx/mt/machine/enroll/poll -H 'Content-Type: application/json' \
        -d '{\"code\":\"$CODE\"}' || true)
      TOKEN=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"token\",\"\"))' 2>/dev/null || true)
      MID=\$(printf '%s' \"\$OUT\" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"machineId\",\"\"))' 2>/dev/null || true)
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
fi

step "run the journey ($JOURNEY)"
silence_service_worker
cd "$APP"
# On a machine where flutter was unpacked by hand (this project's dev box), rather than installed.
# On CI it is already on PATH and this changes nothing.
[ -d "$HOME/tools/flutter/bin" ] && export PATH="$HOME/tools/flutter/bin:$PATH"
# Retried, but only for one specific failure, and the difference matters. `flutter drive` sometimes
# never hands the browser over to the test at all: the app is served, the browser starts, and then
# nothing — no first frame, no note, no error, until something outside kills it. That is the tooling,
# not the product, and it is told apart from a real failure by a fact the harness can check: whether
# the journey said ANYTHING. A journey that got as far as its first step and then failed is reported
# as-is and never retried, because that is exactly the kind of failure this suite exists to catch.
said_something() {
  [ "$(curl -fsS "http://localhost:$MAIL_PORT/notes" 2>/dev/null | head -c 3)" != "[]" ]
}

# The drive runs in the background so the harness can watch for the one thing that says it is alive:
# the journey's first note. Waiting for the whole timeout to find out the browser never arrived costs
# ten minutes per attempt; watching for the first note costs two.
# --no-web-resources-cdn: the engine comes from our own build rather than gstatic, the same flag the
# shipped build uses and for the same reason. Without it a machine that cannot reach the CDN gets a
# page where every asset returns 200 and no frame is ever painted — which looks exactly like the
# tooling hanging.
drive_once() {
  # MT_E2E_APP_URL is read by test_driver/integration_test.dart: it opens the browser at the gateway
  # rather than at flutter's own server, which is what keeps the app and the deployment on one origin.
  ( MT_E2E_APP_URL="http://localhost:$GATEWAY_PORT/" \
    timeout "${MT_E2E_DRIVE_TIMEOUT:-1500}" flutter drive \
    --no-web-resources-cdn \
    --driver=test_driver/integration_test.dart \
    --target=integration_test/${JOURNEY_TARGET} \
    -d web-server \
    --browser-name=chrome \
    --driver-port="$DRIVER_PORT" \
    --web-port="$FLUTTER_PORT" \
    --dart-define=MT_E2E_MAIL=/mail \
    --dart-define=MT_E2E_RUN="$RUN_ID" $TARGET_DEFINES ${MT_E2E_EXTRA_DEFINES:-} \
    --headless ) &
  local drive_pid=$!

  # Two minutes for the browser to start the test. Everything before the first note is build output
  # and page load; after it, the journey's own limits take over and this one steps out of the way.
  local waited=0
  while [ "$waited" -lt "${MT_E2E_FIRST_NOTE_TIMEOUT:-150}" ]; do
    kill -0 "$drive_pid" 2>/dev/null || { wait "$drive_pid"; return $?; }
    said_something && break
    sleep 5
    waited=$((waited + 5))
  done
  if ! said_something; then
    kill "$drive_pid" 2>/dev/null || true
    wait "$drive_pid" 2>/dev/null || true
    return 1
  fi
  wait "$drive_pid"
}
attempt=1
while : ; do
  curl -fsS -X DELETE "http://localhost:$MAIL_PORT/messages" >/dev/null 2>&1 || true
  if drive_once; then
    break
  fi
  if said_something; then
    trace
    fail "the journey failed (attempt $attempt)"
  fi
  [ "$attempt" -ge 3 ] && fail "the browser never reached the test, three times running — that is \
the tooling, not the product; look at /tmp for the flutter drive output"
  echo "(attempt $attempt: the browser never reached the test — retrying)"
  attempt=$((attempt + 1))
done

# --- what only the machine can answer ---------------------------------------------------------------
# The journey ended when the app said the message was stored. Whether it arrived in a program's stdin
# on another host is not something the app can know, and it is the reason this slice exists.
if [ "$JOURNEY" = "full" ]; then
  # Asked of the mock Anthropic API rather than of the program: the agent is the real Claude Code
  # now, and a real program cannot be asked what it heard. The mock in front of it can — and what it
  # answers is stronger, because reaching the MODEL means the text crossed the pty and the TUI too,
  # not merely the pipe into it.
  step "the message reached the model on the machine"
  heard=0
  for _ in $(seq 1 60); do
    if [ "$(verify_model_saw "e2e-marker-$RUN_ID")" = "202" ]; then
      heard=1; break
    fi
    sleep 2
  done
  [ "$heard" = "1" ] || {
    echo "--- connector log ---"; docker exec "$MACHINE_CT" cat /tmp/connector.log 2>/dev/null || true
    fail "what was typed in the interface never reached the model on the machine"
  }
  echo "PASS: the model on the machine was given it"
fi
