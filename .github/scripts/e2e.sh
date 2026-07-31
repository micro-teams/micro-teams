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
# One argument selects what plays the agent's program, which is also what the CI matrix varies:
#
#   fake            a shell script that records what it is told. No node, no npm, no network —
#                   the deterministic baseline, so a red run can be read: if this leg is red, WE
#                   broke something; if only a real-Claude leg is red, Claude Code changed.
#   npm:<version>   real Claude Code at a pinned version, driven by a mock Anthropic API.
#   installer       real Claude Code, latest. Advisory in CI: when Anthropic ships a UI change this
#                   is the leg that tells us, and that is intelligence rather than a reason to block
#                   a merge.
#
# The real-Claude legs additionally assert the thing only they can: that the agent ANSWERS. A mock
# model (MockServer, whose Anthropic emulation streams a proper SSE response) hands Claude Code a
# scripted Bash tool call that runs `microteams api say`, so the reply travels the whole way back
# into the thread — applet, pty, tmux, connector, backend — with no AI anywhere in the loop.
#
# Usage: e2e.sh [fake|npm:<version>|installer]   (run from an unpacked bundle directory)
set -euo pipefail

LEG="${1:-fake}"
MACHINE_CT=microteams-testmachine
MOCK_CT=microteams-testmock
# Claude Code refuses --dangerously-skip-permissions as root, and our own driver omits the flag
# there — so the machine runs the connector as an ordinary user, the way a real one does.
MACHINE_USER=agent
GW="http://localhost:$(grep -E '^NGINX_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 80)"
API="$GW/api"   # cheese-auth (identity)
MT="$GW/mt"     # this backend
USERNAME="ci$(date +%s)"
PASSWORD="ci-password-$RANDOM"
EMAIL="$USERNAME@example.com"

json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

# KEEP=1 leaves the machine and mock containers up after a run, so a failure can be inspected
# instead of re-run blind. CI never sets it.
cleanup() {
  [ "${KEEP:-0}" = "1" ] && { echo "(KEEP=1: leaving $MACHINE_CT and $MOCK_CT up)"; return; }
  docker rm -f "$MACHINE_CT" "$MOCK_CT" >/dev/null 2>&1 || true
}
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
step "spin a machine container and install the connector from the bundle ($LEG)"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$(docker compose ps -q nginx)")"
docker rm -f "$MACHINE_CT" >/dev/null 2>&1 || true
# Started on the default network and attached to the stack's afterwards: everything installed here
# comes from the public internet, and the stack's own network is not the right place to depend on
# for that (a blip there would be reported as a product failure). Once the installs are done the
# container joins the stack and reaches it by service name.
docker run -d --name "$MACHINE_CT" --hostname "$MACHINE_CT" debian:13 sleep infinity >/dev/null
docker exec "$MACHINE_CT" bash -c "set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq ca-certificates curl procps python3 >/dev/null
  useradd -m -s /bin/bash $MACHINE_USER
  mkdir -p /home/$MACHINE_USER/.local/bin /home/$MACHINE_USER/.config/microteams/bin"
docker cp connector/linux-amd64/microteams "$MACHINE_CT:/home/$MACHINE_USER/.local/bin/microteams"
docker cp connector/linux-amd64/tmux "$MACHINE_CT:/home/$MACHINE_USER/.config/microteams/bin/tmux"
docker exec "$MACHINE_CT" bash -c "chmod +x /home/$MACHINE_USER/.local/bin/microteams \
  /home/$MACHINE_USER/.config/microteams/bin/tmux
  chown -R $MACHINE_USER: /home/$MACHINE_USER"
onmachine() { docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -lc "$1"; }
onmachine '$HOME/.local/bin/microteams --version' || fail "the bundled connector does not run"

case "$LEG" in
  fake)
    # Stand-in for Claude Code: print a prompt, then record every submitted line. The point of this
    # leg is the machinery around the program, so a program that cannot fail keeps the signal clean.
    docker exec "$MACHINE_CT" bash -c 'cat > /usr/local/bin/claude <<EOF
#!/bin/bash
echo "fake-claude ready"
while IFS= read -r line; do echo "\$line" >> /tmp/agent-heard.txt; echo "ok"; done
EOF
    chmod +x /usr/local/bin/claude; touch /tmp/agent-heard.txt; chmod 666 /tmp/agent-heard.txt'
    ;;
  npm:*|installer)
    # Real Claude Code, pointed at a mock Anthropic API. API mode (a token + a base URL) is what
    # keeps this out of the OAuth flow entirely — no browser, no login, nothing to approve.
    docker rm -f "$MOCK_CT" >/dev/null 2>&1 || true
    docker run -d --name "$MOCK_CT" --hostname "$MOCK_CT" --network "$NET" \
      mockserver/mockserver:mockserver-7.5.0 >/dev/null
    # Retried: these reach the public internet, and a registry blip should not be reported as a
    # product failure.
    for attempt in 1 2 3; do
      docker exec "$MACHINE_CT" bash -c "set -e
        export DEBIAN_FRONTEND=noninteractive
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
        apt-get install -y -qq nodejs >/dev/null" && break
      echo "  (node install attempt $attempt failed, retrying)"; sleep 5
    done
    case "$LEG" in
      npm:*) for attempt in 1 2 3; do
               docker exec "$MACHINE_CT" npm i -g "@anthropic-ai/claude-code@${LEG#npm:}" >/dev/null 2>&1 && break
               echo "  (claude install attempt $attempt failed, retrying)"; sleep 5
             done ;;
      *)     for attempt in 1 2 3; do
               onmachine 'curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1' && break
               echo "  (claude installer attempt $attempt failed, retrying)"; sleep 5
             done ;;
    esac
    # The agent's program is launched through `bash -lc` by our driver, so the login shell is where
    # its environment has to come from — the same place a real deployment would put a proxy.
    docker exec "$MACHINE_CT" bash -c "cat > /etc/profile.d/anthropic.sh <<EOF
export ANTHROPIC_BASE_URL=http://$MOCK_CT:1080
export ANTHROPIC_AUTH_TOKEN=sk-ant-ci-not-a-real-key
export ANTHROPIC_MODEL=claude-sonnet-4-5
export DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
EOF"
    onmachine 'mkdir -p ~/.claude && printf "{\"hasCompletedOnboarding\":true}" > ~/.claude.json'
    echo -n "claude on the machine: "; onmachine 'claude --version' || fail "Claude Code did not install"
    ;;
  *) fail "unknown leg: $LEG" ;;
esac
docker network connect "$NET" "$MACHINE_CT"
if [ "$LEG" != "fake" ]; then
  for _ in $(seq 1 30); do
    docker exec "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/status" >/dev/null 2>&1 && break
    sleep 1
  done
fi
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
docker exec -u "$MACHINE_USER" "$MACHINE_CT" bash -c "cat > /home/$MACHINE_USER/.config/microteams/config.json <<EOF
{\"base\":\"http://nginx/mt\",\"token\":\"$MACHINE_TOKEN\",\"machine_id\":\"$MACHINE_ID\"}
EOF"
docker exec -d -u "$MACHINE_USER" "$MACHINE_CT" bash -lc \
  '$HOME/.local/bin/microteams run --config $HOME/.config/microteams/config.json >/tmp/connector.log 2>&1'
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
SOCK="/tmp/microteams-$(docker exec -u "$MACHINE_USER" "$MACHINE_CT" id -u | tr -d '\r')/t.sock"
mtmux() { docker exec -u "$MACHINE_USER" "$MACHINE_CT" \
  "/home/$MACHINE_USER/.config/microteams/bin/tmux" -S "$SOCK" "$@"; }
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
# Wait for the program to be ready to be talked to, read from the terminal itself rather than from
# the applet's mirrored status: the fake program has no Claude UI to report, and on the real legs
# what matters here is that Claude Code has finished its gates and is showing its prompt. Typing
# into a terminal that is still painting is a real way to lose a message (see T-064), so this waits.
if [ "$LEG" != "fake" ]; then
  step "Claude Code reaches its prompt"
  for _ in $(seq 1 60); do
    PANE="$(mtmux capture-pane -p -t "$SID" 2>/dev/null || true)"
    printf '%s' "$PANE" | grep -qE 'for shortcuts|for agents' && { READY=1; break; }
    printf '%s' "$PANE" | grep -q 'Pane is dead' && { echo "$PANE"; fail "Claude Code exited during startup"; }
    sleep 2
  done
  [ "${READY:-0}" = "1" ] || { mtmux capture-pane -p -t "$SID" || true; fail "Claude Code never reached its prompt"; }
  pass "Claude Code is at its prompt"
fi

step "a chat message reaches the agent"
THREAD_ID="$(curl -fsS -X POST "$MT/chat" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"ci\",\"memberIds\":[$AGENT_ID]}" | json "d['id']")"
MARKER="ci-marker-$RANDOM"

if [ "$LEG" != "fake" ]; then
  # Script the model: when Claude Code sends the conversation request (the one carrying its tool
  # list), answer with a Bash tool call that posts a reply as the agent. Matching on the tool list
  # matters — Claude Code also asks this endpoint for a session title, with no tools, and a
  # once-only expectation would otherwise be spent on that. `streaming` is not optional either: a
  # non-streamed tool call is silently ignored by Claude Code, which looks exactly like nothing
  # happening.
  REPLY="pong-$MARKER"
  docker exec -i "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/expectation" \
    -H 'Content-Type: application/json' --data-binary @- >/dev/null <<JSON
{ "httpRequest": { "method": "POST", "path": "/v1/messages",
                   "body": { "type": "JSON_PATH", "jsonPath": "\$.tools[?(@.name=='Bash')]" } },
  "times": { "remainingTimes": 1, "unlimited": false },
  "priority": 10,
  "httpLlmResponse": { "provider": "ANTHROPIC", "model": "claude-sonnet-4-5",
    "completion": { "text": "Answering the group.", "streaming": true, "stopReason": "tool_use",
      "toolCalls": [ { "id": "toolu_ci_reply", "name": "Bash",
        "arguments": "{\"command\":\"microteams api say --thread-id $THREAD_ID --text '$REPLY'\",\"description\":\"reply\"}" } ],
      "usage": { "inputTokens": 200, "outputTokens": 30 } } } }
JSON
  docker exec -i "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/expectation" \
    -H 'Content-Type: application/json' --data-binary @- >/dev/null <<'JSON'
{ "httpRequest": { "method": "POST", "path": "/v1/messages" },
  "priority": 1,
  "httpLlmResponse": { "provider": "ANTHROPIC", "model": "claude-sonnet-4-5",
    "completion": { "text": "done", "streaming": true, "stopReason": "end_turn",
                    "usage": { "inputTokens": 60, "outputTokens": 3 } } } }
JSON
fi

curl -fsS -X POST "$MT/chat/$THREAD_ID/messages" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"content\":\"$MARKER\"}" >/dev/null

if [ "$LEG" = "fake" ]; then
  # The message crossed the backend, the control channel, the applet, the pty and tmux if — and
  # only if — the program on the far end can show it back to us.
  for _ in $(seq 1 40); do
    if docker exec "$MACHINE_CT" grep -q "$MARKER" /tmp/agent-heard.txt 2>/dev/null; then
      pass "the agent's program received the message"; HEARD=1; break
    fi
    sleep 2
  done
else
  # The stronger assertion, and the only one a real Claude Code can make: the agent ANSWERS. The
  # reply has to come back through `microteams api say`, so seeing it in the thread means the whole
  # round trip worked — including the tool door the agent authenticates through.
  for _ in $(seq 1 60); do
    if curl -fsS "$MT/chat/$THREAD_ID/messages?page_size=50" -H "$AUTH" | grep -q "pong-$MARKER"; then
      pass "the agent replied in the thread (real Claude Code, scripted model)"; HEARD=1; break
    fi
    sleep 3
  done
fi

[ "${HEARD:-0}" = "1" ] || {
  echo "--- connector log ---"; docker exec "$MACHINE_CT" cat /tmp/connector.log || true
  echo "--- what the pane shows ---"; mtmux capture-pane -p -t "$SID" || true
  [ "$LEG" != "fake" ] && { echo "--- what the model was asked ---"
    docker exec "$MACHINE_CT" curl -s -X PUT "http://$MOCK_CT:1080/mockserver/retrieve?type=REQUESTS&format=JSON" \
      -d '{"path":"/v1/messages"}' | head -c 2000; }
  fail "the message never completed its round trip"
}

# --- the failure this system keeps hitting -------------------------------------------------------
# A dead tmux used to pass for a live screen: the applet runtime lives in the connector process, so it
# survives the session it was driving, and `microteams status` counted map entries rather than
# sessions. Killing the server here is the cheapest possible reproduction of that production incident.
step "a screen whose tmux died is reported as gone, not as running"
mtmux kill-server 2>/dev/null || true
sleep 3
# `microteams status` must stop claiming a running screen. (Older connectors report the stale count.)
STATUS="$(onmachine '$HOME/.local/bin/microteams status --config $HOME/.config/microteams/config.json' 2>&1 || true)"
printf '%s\n' "$STATUS"
printf '%s' "$STATUS" | grep -qE 'screens +(0|none)' ||
  fail "status still reports running screens after the tmux server died"
pass "the connector no longer counts a screen whose tmux is gone"

step "everything asserted"
