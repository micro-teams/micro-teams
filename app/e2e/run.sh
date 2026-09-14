#!/usr/bin/env bash
#
# Run an end-to-end journey against a real deployment of the shipped bundle, driving the Compose
# Multiplatform web client the way tool/e2e (in the retired Flutter client) drove that one: the
# real bundle, a real machine with the connector on it, one origin in front of both.
#
# v0 scope, matching the client's own: sign-in, the chat list, reading/sending in a thread, the
# agent list, opening a live screen. Everything the client cannot yet DO through its own UI —
# signing up, creating a team, creating a chat, enrolling and approving a machine, opening an
# agent — is set up here through the API directly, the same way a developer would with curl before
# that screen existed. As those screens get built, drive them instead of the API call they replace;
# that is the whole point of keeping this file alive across the rewrite rather than writing it once
# and leaving it be.
#
#   bash e2e/run.sh --bundle <dir> [--keep]
#
# --bundle  an unpacked deployment bundle (the microteams-deploy artifact, or deploy/ with the
#           build outputs in place). Required: this suite tests what we ship, not a dev server.
# --dist    the compose web build to test — defaults to composeApp/build/dist/wasmJs/productionExecutable,
#           which is what `./gradlew :composeApp:wasmJsBrowserDistribution` produces.
# --keep    leave the stack, the gateway and the mail sink running afterwards, to inspect a failure.
set -euo pipefail

BUNDLE=""
DIST=""
LEG="npm:2.1.220"
MACHINE_IMAGE="${MT_E2E_MACHINE_IMAGE:-debian:13}"
KEEP="${KEEP:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) BUNDLE="$2"; shift 2 ;;
    --dist)   DIST="$2"; shift 2 ;;
    --leg)    LEG="$2"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BUNDLE" ] || { echo "--bundle <dir> is required" >&2; exit 2; }
BUNDLE="$(cd "$BUNDLE" && pwd)"
[ -f "$BUNDLE/docker-compose.yml" ] || { echo "$BUNDLE is not a deployment bundle" >&2; exit 2; }
[ -f "$BUNDLE/origin/origin.jar" ] || {
  echo "$BUNDLE has no origin/origin.jar — the substrate would not be exercised" >&2; exit 2; }

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$APP/e2e"
[ -n "$DIST" ] || DIST="$APP/composeApp/build/dist/wasmJs/productionExecutable"
[ -f "$DIST/index.html" ] || {
  echo "$DIST has no index.html — build it first: ./gradlew :composeApp:wasmJsBrowserDistribution" >&2
  exit 2
}

PROJECT="${MT_E2E_PROJECT:-mte2ec}"
STACK_PORT="${MT_E2E_STACK_PORT:-52180}"
GATEWAY_PORT="${MT_E2E_GATEWAY_PORT:-52181}"
APP_PORT="${MT_E2E_APP_PORT:-52190}"
SMTP_PORT="${MT_E2E_SMTP_PORT:-52126}"
MAIL_PORT="${MT_E2E_MAIL_PORT:-52127}"
GATEWAY_CT="${PROJECT}-gateway"
MACHINE_CT="${PROJECT}-machine"
MOCK_CT="${PROJECT}-mock"
MAIL_CT="${PROJECT}-mail"
MACHINE_USER=agent
RUN_ID="$(date +%s)$$"

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; trace; exit 1; }

# Installing the agent's program and scripting what the model says back are shared with the
# Flutter-era e2e and the machinery e2e: one copy, because it is the same paragraph either way.
# shellcheck source=../../.github/scripts/agent-leg.sh
. "$APP/../.github/scripts/agent-leg.sh"

trace() {
  if docker ps --format '{{.Names}}' | grep -qx "$MACHINE_CT"; then
    printf '\n--- what the connector on the machine said ---\n'
    docker exec "$MACHINE_CT" tail -25 /tmp/connector.log 2>/dev/null ||
      echo '(no connector log — it never started)'
  fi
  if docker ps --format '{{.Names}}' | grep -q "^${PROJECT}-backend"; then
    printf '\n--- anything that looked like an exception, anywhere in the backend log ---\n'
    (cd "$BUNDLE" && docker compose -p "$PROJECT" logs --no-color backend 2>/dev/null) |
      grep -iE 'Exception|ERROR' || echo '(none)'
  fi
  printf '\n--- what the static server for the app under test said ---\n'
  [ -f /tmp/mte2ec-static.log ] && tail -20 /tmp/mte2ec-static.log || true
}

STATIC_PID=""
cleanup() {
  [ -n "$STATIC_PID" ] && kill "$STATIC_PID" 2>/dev/null || true
  if [ "$KEEP" = "1" ]; then
    echo "(--keep: the stack, the gateway and the mail sink are still up; app on :$GATEWAY_PORT)"
    return
  fi
  docker rm -f "$GATEWAY_CT" "$MACHINE_CT" "$MOCK_CT" "$MAIL_CT" >/dev/null 2>&1 || true
  (cd "$BUNDLE" && docker compose -p "$PROJECT" down -v >/dev/null 2>&1) || true
}
trap cleanup EXIT

step "check the ports are free"
for port in "$STACK_PORT" "$GATEWAY_PORT" "$APP_PORT" "$SMTP_PORT" "$MAIL_PORT"; do
  holder="$(ss -ltnpH "sport = :$port" 2>/dev/null || true)"
  [ -z "$holder" ] && continue
  echo "port $port is already in use: $holder" >&2
  echo "(a previous run may not have cleaned up: kill it, or set MT_E2E_* to another block)" >&2
  exit 1
done

# --- the deployment ------------------------------------------------------------------------------
step "deploy the bundle"
cd "$BUNDLE"
if [ ! -f .env ]; then
  if [ -d app_data ] && ! rm -rf app_data 2>/dev/null; then
    docker run --rm -v "$PWD/app_data:/state" debian:13 rm -rf /state >/dev/null 2>&1 || true
    rm -rf app_data 2>/dev/null || true
  fi
  bash gen-env.sh >/dev/null
fi
sed -i \
  -e "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=127.0.0.1/" \
  -e "s/^EMAIL_SMTP_PORT=.*/EMAIL_SMTP_PORT=$SMTP_PORT/" \
  -e "s|^EMAIL_DEFAULT_FROM=.*|EMAIL_DEFAULT_FROM=MicroTeams <no-reply@example.com>|" .env
grep -q '^NGINX_HTTP_PORT=' .env || echo "NGINX_HTTP_PORT=$STACK_PORT" >> .env
sed -i "s/^NGINX_HTTP_PORT=.*/NGINX_HTTP_PORT=$STACK_PORT/" .env
docker compose -p "$PROJECT" up -d --wait || fail "the bundle did not come up healthy"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$(docker compose -p "$PROJECT" ps -q nginx)")"

# --- the mail sink -------------------------------------------------------------------------------
step "start the mail sink"
docker rm -f "$MAIL_CT" >/dev/null 2>&1 || true
docker run -d --name "$MAIL_CT" --network "$NET" \
  -v "$E2E/mailsink.py:/mailsink.py:ro" \
  -p "$MAIL_PORT:$MAIL_PORT" \
  python:3.12-slim python /mailsink.py --smtp-port "$SMTP_PORT" --http-port "$MAIL_PORT" \
  >/dev/null || fail "the mail sink did not start"
for _ in $(seq 1 20); do
  curl -fsS "http://localhost:$MAIL_PORT/messages" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -X DELETE "http://localhost:$MAIL_PORT/messages" >/dev/null

SMTP_HOST="${MT_E2E_SMTP_HOST:-$MAIL_CT}"
sed -i "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=$SMTP_HOST/" .env
docker compose -p "$PROJECT" up -d --wait cheese-auth ||
  fail "cheese-auth did not come back up with the mail relay set"

# --- the app under test, served statically -------------------------------------------------------
step "serve the compose web build"
( cd "$DIST" && python3 -m http.server "$APP_PORT" --bind 127.0.0.1 >/tmp/mte2ec-static.log 2>&1 ) &
STATIC_PID=$!
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/index.html" && break
  sleep 0.5
done

# --- one origin ------------------------------------------------------------------------------------
step "put a gateway in front"
docker rm -f "$GATEWAY_CT" >/dev/null 2>&1 || true
docker run -d --name "$GATEWAY_CT" --network "$NET" \
  --add-host host.docker.internal:host-gateway \
  -e "APP_PORT=$APP_PORT" -e "MAIL_PORT=$MAIL_PORT" -e "MAIL_HOST=$MAIL_CT" \
  -p "$GATEWAY_PORT:80" \
  -v "$E2E/gateway.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  -v "$E2E/e2e-proxy.inc:/etc/nginx/e2e-proxy.inc:ro" \
  nginx:1.27-alpine >/dev/null
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://localhost:$GATEWAY_PORT/mt/lines" && break
  sleep 1
done
curl -fsS "http://localhost:$GATEWAY_PORT/mt/lines" >/dev/null 2>&1 ||
  fail "the gateway cannot reach the deployment"
BASE="http://localhost:$GATEWAY_PORT"

# --- an account, a team, a chat -- everything the client cannot yet make for itself ----------------
step "sign up (via the API — no registration screen in the client yet)"
USERNAME="e2e$RUN_ID"
EMAIL="$USERNAME@example.com"
PASSWORD="e2e-pw-$RUN_ID"
curl -fsS -X POST "$BASE/api/users/verify/email" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\"}" >/dev/null || fail "could not request a verify code"
CODE=""
for _ in $(seq 1 30); do
  CODE="$(curl -fsS "http://localhost:$MAIL_PORT/note?text=$EMAIL" 2>/dev/null |
    grep -oE '[0-9]{6}' | head -1 || true)"
  [ -n "$CODE" ] && break
  sleep 1
done
[ -n "$CODE" ] || fail "no verify code arrived at the mail sink for $EMAIL"
SIGNUP="$(curl -fsS -X POST "$BASE/api/users/" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"nickname\":\"$USERNAME\",\"password\":\"$PASSWORD\",\
\"email\":\"$EMAIL\",\"emailCode\":\"$CODE\"}")" || fail "sign-up failed"
TOKEN="$(printf '%s' "$SIGNUP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')"
auth() { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }

step "a team, a chat, a message already in it"
TEAM_ID="$(auth -X POST "$BASE/mt/team" -H 'Content-Type: application/json' \
  -d "{\"name\":\"e2e team $RUN_ID\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
THREAD="$(auth -X POST "$BASE/mt/chat" -H 'Content-Type: application/json' \
  -d "{\"title\":\"e2e thread $RUN_ID\"}")"
THREAD_ID="$(printf '%s' "$THREAD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
SEEDED_TEXT="already here before the client asked — $RUN_ID"
auth -X POST "$BASE/mt/chat/$THREAD_ID/messages" -H 'Content-Type: application/json' \
  -d "{\"content\":\"$SEEDED_TEXT\"}" >/dev/null || fail "could not seed a message"

# --- a machine, a connector, an agent — everything "open a screen" needs -----------------------------
step "spin a host and install the connector from the bundle (leg: $LEG)"
docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true
docker run -d --name "$MACHINE_CT" --hostname "$MACHINE_CT" \
  "$MACHINE_IMAGE" sleep infinity >/dev/null
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

onmachine() { docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -lc "$1"; }
install_agent_program "$LEG"
docker network connect "$NET" "$MACHINE_CT"
wait_for_mock

step "enroll and approve the machine (via the API — no approve-device screen in the client yet)"
ENROLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST "http://nginx/mt/machine/enroll/start" \
  -H 'Content-Type: application/json' -d '{"name":"e2e-machine"}')"
ENROLL_CODE="$(printf '%s' "$ENROLL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
auth -X POST "$BASE/mt/machine/enroll/approve" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$ENROLL_CODE\",\"teamIds\":[$TEAM_ID]}" >/dev/null || fail "approval failed"
TOKEN_JSON=""
for _ in $(seq 1 60); do
  TOKEN_JSON="$(docker exec "$MACHINE_CT" curl -fsS -X POST "http://nginx/mt/machine/enroll/poll" \
    -H 'Content-Type: application/json' -d "{\"code\":\"$ENROLL_CODE\"}")"
  MTOKEN="$(printf '%s' "$TOKEN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token") or "")')"
  [ -n "$MTOKEN" ] && break
  sleep 2
done
[ -n "$MTOKEN" ] || fail "the machine never got a token"
MID="$(printf '%s' "$TOKEN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("machineId") or "")')"
docker exec "$MACHINE_CT" bash -c "printf '{\"base\":\"http://nginx/mt\",\"token\":\"%s\",\"machine_id\":\"%s\"}' \
  '$MTOKEN' '$MID' > /home/$MACHINE_USER/.config/microteams/config.json
  chown $MACHINE_USER: /home/$MACHINE_USER/.config/microteams/config.json"
docker exec -d -u "$MACHINE_USER" "$MACHINE_CT" bash -lc \
  '$HOME/.local/bin/microteams run --config $HOME/.config/microteams/config.json > /tmp/connector.log 2>&1'
for _ in $(seq 1 60); do
  ONLINE="$(auth "$BASE/mt/machine/$MID" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("online"))' 2>/dev/null || true)"
  [ "$ONLINE" = "True" ] && break
  sleep 2
done
[ "$ONLINE" = "True" ] || fail "the machine never came online"

step "open an agent on it (via the API — no open-agent screen in the client yet)"
OPENED="$(auth -X POST "$BASE/mt/agent" -H 'Content-Type: application/json' \
  -d "{\"machineId\":\"$MID\",\"teamId\":$TEAM_ID}")" || fail "opening the agent failed"

# --- the journey, driven for real through the compose client ---------------------------------------
step "drive the client"
cd "$E2E"
npm ci >/dev/null
E2E_BASE_URL="$BASE" \
E2E_USERNAME="$USERNAME" \
E2E_PASSWORD="$PASSWORD" \
E2E_SEEDED_TEXT="$SEEDED_TEXT" \
E2E_MACHINE_ID="$MID" \
  npx playwright test --reporter=line
