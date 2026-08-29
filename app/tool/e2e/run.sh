#!/usr/bin/env bash
#
# Run the end-to-end journey against a real deployment of the shipped bundle.
#
# This is the outside half of the suite described in todo/microteams/testing-e2e.md. It deploys the
# bundle exactly the way deploy/README.md tells a customer to, puts a gateway in front so the app
# and the server share one origin, and then starts one self-contained journey inside a real browser.
# It hands parameters in and collects a result; it never directs the test.
#
#   bash tool/e2e/run.sh --bundle <dir> [--leg web] [--keep]
#
# --bundle   an unpacked deployment bundle (the microteams-deploy artifact, or deploy/ with the
#            build outputs in place). Required: this suite tests what we ship, not a dev server.
# --keep     leave the stack, the gateway and the mail sink running afterwards, to inspect a failure.
#
# Ports live in one block (52000–52099) so several agents can share the dev machine; override any of
# them with the environment variables below.
set -euo pipefail

BUNDLE=""
LEG="web"
KEEP="${KEEP:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) BUNDLE="$2"; shift 2 ;;
    --leg)    LEG="$2"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
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
RUN_ID="$(date +%s)$$"

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

MAILSINK_PID=""
CHROMEDRIVER_PID=""
cleanup() {
  [ -n "$MAILSINK_PID" ] && kill "$MAILSINK_PID" 2>/dev/null || true
  [ -n "$CHROMEDRIVER_PID" ] && kill "$CHROMEDRIVER_PID" 2>/dev/null || true
  if [ "$KEEP" = "1" ]; then
    echo "(--keep: the stack, the gateway and the mail sink are still up on :$GATEWAY_PORT)"
    return
  fi
  docker rm -f "$GATEWAY_CT" >/dev/null 2>&1 || true
  (cd "$BUNDLE" && docker compose -p "$PROJECT" down -v >/dev/null 2>&1) || true
}
trap cleanup EXIT

# --- nothing left over from last time -------------------------------------------------------------
# A killed run leaves a web server, a chromedriver, or a browser holding one of these ports, and the
# next run then talks to the WRONG one: the driver waits for a connection from an app that a stale
# server is serving, and the whole thing hangs with no error. Fail loudly instead, and clear what is
# ours to clear.
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
  bash gen-env.sh >/dev/null
fi
HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
sed -i \
  -e "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=${MT_E2E_SMTP_HOST:-$HOST_IP}/" \
  -e "s/^EMAIL_SMTP_PORT=.*/EMAIL_SMTP_PORT=$SMTP_PORT/" \
  -e "s|^EMAIL_DEFAULT_FROM=.*|EMAIL_DEFAULT_FROM=MicroTeams <no-reply@example.com>|" .env
grep -q '^NGINX_HTTP_PORT=' .env || echo "NGINX_HTTP_PORT=$STACK_PORT" >> .env
sed -i "s/^NGINX_HTTP_PORT=.*/NGINX_HTTP_PORT=$STACK_PORT/" .env
docker compose -p "$PROJECT" up -d --wait || fail "the bundle did not come up healthy"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$(docker compose -p "$PROJECT" ps -q nginx)")"

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
# Debug, and not by preference: `--web-launch-url` is what puts the browser on the gateway's origin
# instead of on flutter's own server, and the tool only honours it in debug. A release run was tried
# and the browser went straight to http://localhost:<web-port>, where /api and /mt do not exist.
#
# The cost is that a debug build talks to the tool over dwds — a stream of small POSTs on the page's
# origin, so through the gateway — and nginx must not buffer or reorder them (see e2e-proxy.inc).
step "run the journey ($LEG)"
cd "$APP"
export PATH="$HOME/tools/flutter/bin:$PATH"
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/journey_test.dart \
  -d web-server \
  --browser-name=chrome \
  --driver-port="$DRIVER_PORT" \
  --web-port="$FLUTTER_PORT" \
  --web-launch-url="http://localhost:$GATEWAY_PORT/" \
  --dart-define=MT_E2E_MAIL=/mail \
  --dart-define=MT_E2E_RUN="$RUN_ID" ${MT_E2E_EXTRA_DEFINES:-} \
  --headless
