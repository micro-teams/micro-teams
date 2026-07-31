#!/usr/bin/env bash
# Full-stack smoke test: the shipped bundle, a real machine, a real agent, one real message.
#
# What this covers that nothing else does. The unit and integration tests exercise the backend with a
# FAKE machine (a WebSocket client in the test JVM), and `test-compose` only proved the containers
# reach "healthy". Neither can see the half of this system that lives on a machine: the connector
# binary, its private tmux, the applet driving a real terminal, and the chain that carries a chat
# message from an HTTP POST all the way into a program's stdin. Every production incident so far has
# lived exactly there — a screen whose tmux died still reported as running, a woken agent that never
# got its Enter, a disconnect that stopped the wrong service — and none of them could have been
# caught by a test that stops at "the containers are up".
#
# So this boots the bundle a customer would deploy, spins a plain Debian container as a machine (the
# closest thing to a VM that CI can afford), installs the connector FROM THAT BUNDLE, enrolls it
# through the real approval flow, opens an agent on it, and asserts the message actually arrives in
# the program's terminal. The "agent program" is a fake `claude` — a shell script that appends what it
# is told to a file — because the point is to test our machinery, not Anthropic's, and a fake makes
# the assertion exact: the text is either in that file or it is not.
#
# Usage: fullstack-smoke.sh   (run from an unpacked bundle directory that has docker-compose.yml)
set -euo pipefail

MACHINE_CT=microteams-testmachine
GW="http://localhost:$(grep -E '^NGINX_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 80)"
API="$GW/api"   # cheese-auth (identity)
MT="$GW/mt"     # this backend
USERNAME="ci$(date +%s)"
PASSWORD="ci-password-$RANDOM"
EMAIL="$USERNAME@example.com"

json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

cleanup() { docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

# --- a human ----------------------------------------------------------------------------------
# Registration mails a verification code, and CI has no SMTP — so the user is inserted the way the
# backend's own tests do it, then logged in through the REAL login endpoint (which is the part worth
# exercising: it mints the JWT everything else here depends on). The password hash comes from
# cheese-auth's own bcrypt, so the hash format can never drift from what it verifies against.
step "create a user and log in"
COMPOSE_USER_SVC=$(docker compose ps --format '{{.Service}}' | grep -x cheese-auth || echo cheese-auth)
HASH="$(docker compose exec -T "$COMPOSE_USER_SVC" node -e \
  "console.log(require('bcryptjs').hashSync('$PASSWORD',10))" | tr -d '\r')"
[ -n "$HASH" ] || fail "could not mint a password hash with cheese-auth's bcrypt"
docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-microteams}" -d "${POSTGRES_DB:-microteams}" <<SQL >/dev/null
INSERT INTO public."user" (username, hashed_password, email, created_at, updated_at)
VALUES ('$USERNAME', '$HASH', '$EMAIL', now(), now());
INSERT INTO public.user_profile (nickname, intro, avatar_id, user_id, created_at, updated_at)
SELECT 'CI Human', 'ci', 1, id, now(), now() FROM public."user" WHERE username = '$USERNAME';
SQL
TOKEN="$(curl -fsS -X POST "$API/users/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | json "d['data']['accessToken']")"
[ -n "$TOKEN" ] || fail "login returned no access token"
AUTH="Authorization: Bearer $TOKEN"
pass "logged in as $USERNAME"

step "create a team"
TEAM_ID="$(curl -fsS -X POST "$MT/team" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"CI Team"}' | json "d['id']")"
[ -n "$TEAM_ID" ] || fail "no team id"
pass "team $TEAM_ID"

# --- a machine --------------------------------------------------------------------------------
# A plain Debian container on the compose network, standing in for a customer's box. It gets the
# connector and the static tmux from the bundle's own connector/ directory — the same files the
# backend serves to a real machine — so a broken or missing binary in the bundle fails here.
step "spin a machine container and install the connector from the bundle"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$(docker compose ps -q nginx)")"
docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true
docker run -d --name "$MACHINE_CT" --hostname "$MACHINE_CT" --network "$NET" debian:13 sleep infinity >/dev/null
docker exec "$MACHINE_CT" bash -c 'set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq ca-certificates curl procps python3 >/dev/null
  mkdir -p /root/.local/bin /root/.config/microteams/bin'
docker cp connector/linux-amd64/microteams "$MACHINE_CT:/root/.local/bin/microteams"
docker cp connector/linux-amd64/tmux "$MACHINE_CT:/root/.config/microteams/bin/tmux"
docker exec "$MACHINE_CT" chmod +x /root/.local/bin/microteams /root/.config/microteams/bin/tmux
docker exec "$MACHINE_CT" /root/.local/bin/microteams --version || fail "the bundled connector does not run"

# The agent program. Real Claude Code needs an account and a network CI has no business using, and
# what is under test is our side of the wire: that a message reaches the program's terminal at all.
# This one records what it is given, which makes the assertion exact rather than a screen-scrape.
docker exec "$MACHINE_CT" bash -c 'cat > /usr/local/bin/claude <<EOF
#!/bin/bash
# Stand-in for Claude Code: print a prompt, then append every submitted line to a file.
echo "fake-claude ready"
while IFS= read -r line; do echo "\$line" >> /tmp/agent-heard.txt; echo "ok"; done
EOF
chmod +x /usr/local/bin/claude'
pass "machine container ready"

step "enroll the machine through the real approval flow"
ENROLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST "http://nginx/mt/machine/enroll/start" \
  -H 'Content-Type: application/json' -d '{"name":"ci-machine"}')"
CODE="$(printf '%s' "$ENROLL" | json "d['code']")"
[ -n "$CODE" ] || fail "enrollment start returned no code"
curl -fsS -X POST "$MT/machine/enroll/approve" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\",\"teamIds\":[$TEAM_ID]}" >/dev/null || fail "approve rejected the code"
POLL="$(docker exec "$MACHINE_CT" curl -fsS -X POST "http://nginx/mt/machine/enroll/poll" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}")"
MACHINE_ID="$(printf '%s' "$POLL" | json "d.get('machineId','')")"
MACHINE_TOKEN="$(printf '%s' "$POLL" | json "d.get('token','')")"
[ -n "$MACHINE_ID" ] && [ -n "$MACHINE_TOKEN" ] || fail "poll did not hand over a machine id + token: $POLL"
pass "machine $MACHINE_ID enrolled"

# `link connect` installs a systemd service, which a container has no init for — so the connector is
# run the way that service would run it. Everything downstream (control channel, screens, tmux) is
# identical; only the supervisor differs.
step "connect the machine"
docker exec "$MACHINE_CT" bash -c "cat > /root/.config/microteams/config.json <<EOF
{\"base\":\"http://nginx/mt\",\"token\":\"$MACHINE_TOKEN\",\"machine_id\":\"$MACHINE_ID\"}
EOF"
docker exec -d "$MACHINE_CT" bash -c \
  '/root/.local/bin/microteams run --config /root/.config/microteams/config.json >/tmp/connector.log 2>&1'
for _ in $(seq 1 30); do
  online="$(curl -fsS "$MT/machine/$MACHINE_ID" -H "$AUTH" | json "str(d.get('online',False))")"
  [ "$online" = "True" ] && break
  sleep 1
done
[ "$online" = "True" ] || { docker exec "$MACHINE_CT" cat /tmp/connector.log; fail "machine never came online"; }
pass "machine is online"

# --- an agent ---------------------------------------------------------------------------------
step "open an agent on it"
OPENED="$(curl -fsS -X POST "$MT/agent" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"machineId\":\"$MACHINE_ID\",\"teamId\":$TEAM_ID,\"nickname\":\"CI Agent\"}")"
AGENT_ID="$(printf '%s' "$OPENED" | json "d['agentUserId']")"
SID="$(printf '%s' "$OPENED" | json "d['sid']")"
[ -n "$AGENT_ID" ] && [ -n "$SID" ] || fail "open-agent did not return an agent + screen: $OPENED"
pass "agent $AGENT_ID on screen $SID"

step "the screen really exists on the machine"
# The connector keeps its tmux on a private socket under /tmp, named by the uid it runs as — the
# same path the connector derives, resolved here rather than assumed.
SOCK="/tmp/microteams-$(docker exec "$MACHINE_CT" id -u | tr -d '\r')/t.sock"
mtmux() { docker exec "$MACHINE_CT" /root/.config/microteams/bin/tmux -S "$SOCK" "$@"; }
for _ in $(seq 1 30); do
  mtmux has-session -t "$SID" 2>/dev/null && break
  sleep 1
done
mtmux has-session -t "$SID" 2>/dev/null ||
  { docker exec "$MACHINE_CT" cat /tmp/connector.log; fail "no tmux session for $SID on the machine"; }
pass "tmux session $SID is live"

# --- one message, end to end -------------------------------------------------------------------
# The assertion this whole harness exists for: an ordinary HTTP POST to a chat thread ends up as text
# inside a program running in a terminal on another host. It crosses the backend, the control
# channel, the screen applet, the pty and tmux — the exact path that no other test covers.
step "a chat message reaches the program's terminal"
THREAD_ID="$(curl -fsS -X POST "$MT/chat" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"ci\",\"memberIds\":[$AGENT_ID]}" | json "d['id']")"
MARKER="ci-marker-$RANDOM"
curl -fsS -X POST "$MT/chat/$THREAD_ID/messages" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"content\":\"$MARKER\"}" >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$MACHINE_CT" grep -q "$MARKER" /tmp/agent-heard.txt 2>/dev/null; then
    pass "the agent's program received the message"
    HEARD=1; break
  fi
  sleep 2
done
[ "${HEARD:-0}" = "1" ] || {
  echo "--- connector log ---"; docker exec "$MACHINE_CT" cat /tmp/connector.log || true
  echo "--- what the pane shows ---"
  mtmux capture-pane -p -t "$SID" || true
  fail "the message never reached the program (this is the T-064 class of bug)"
}

# --- the failure this system keeps hitting -------------------------------------------------------
# A dead tmux used to pass for a live screen: the applet runtime lives in the connector process, so it
# survives the session it was driving, and `microteams status` counted map entries rather than
# sessions. Killing the server here is the cheapest possible reproduction of that production incident.
step "a screen whose tmux died is reported as gone, not as running"
mtmux kill-server 2>/dev/null || true
sleep 3
# `microteams status` must stop claiming a running screen. (Older connectors report the stale count.)
STATUS="$(docker exec "$MACHINE_CT" /root/.local/bin/microteams status \
  --config /root/.config/microteams/config.json 2>&1 || true)"
printf '%s\n' "$STATUS"
printf '%s' "$STATUS" | grep -qE 'screens +(0|none)' ||
  fail "status still reports running screens after the tmux server died"
pass "the connector no longer counts a screen whose tmux is gone"

step "everything asserted"
