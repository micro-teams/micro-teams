#!/usr/bin/env bash
# The machinery under the product: the shipped bundle, a real machine, a real agent, one real
# message — driven by curl, with no client in the picture.
#
# It used to be called the full-stack test, and it is not: nothing here touches the interface a
# person uses, so it cannot tell you whether they can reach any of it. That is what the journeys do
# (app/integration_test/, run by app/tool/e2e/run.sh). This script is the layer underneath, and the
# division is worth keeping: when this is red the plumbing broke; when a journey is red the product
# did.
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
# the program's terminal. The agent's program is the real Claude Code, in front of a mock Anthropic
# API — so there is no AI anywhere in the loop, and nothing here depends on what a model decides to
# say.
#
# One argument selects which Claude Code, which is also what the CI matrix varies:
#
#   npm:<version>   real Claude Code at a PINNED version. This is where determinism comes from:
#                   nothing about it can change without somebody changing the number, so when this
#                   leg is red, WE broke something.
#   installer       real Claude Code, latest. Advisory in CI: when Anthropic ships a UI change this
#                   is the leg that tells us, and that is intelligence rather than a reason to block
#                   a merge.
#
# There used to be a third, `fake`: a shell script pretending to be Claude, kept as "the
# deterministic baseline". It is gone. Pinning already buys determinism, and the stand-in cost a
# second implementation of every leg while proving nothing about driving the real program. The one
# thing it uniquely carried — reading back the exact bytes the agent was handed (T-058) — moved to
# the mock's own request log, which is a stronger place to read it from.
#
# Both legs assert the thing that matters most: that the agent ANSWERS. MockServer's Anthropic
# emulation streams a proper SSE response handing Claude Code a scripted Bash tool call that runs
# `microteams api say`, so the reply travels the whole way back into the thread — applet, pty, tmux,
# connector, backend.
#
# Usage: e2e.sh [npm:<version>|installer]   (run from an unpacked bundle directory)
set -euo pipefail

# Installing the agent's program and scripting the model are shared with app/tool/e2e/run.sh — see
# that file for why there is one copy rather than two.
# shellcheck source=agent-leg.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-leg.sh"

LEG="${1:-npm:2.1.220}"
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

install_agent_program "$LEG"
docker network connect "$NET" "$MACHINE_CT"
wait_for_mock
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
# the applet's mirrored status: what matters is that Claude Code has finished its gates and is
# showing its prompt. Typing into a terminal that is still painting is a real way to lose a message
# (see T-064), so this waits.
{
  step "Claude Code reaches its prompt"
  for _ in $(seq 1 60); do
    PANE="$(mtmux capture-pane -p -t "$SID" 2>/dev/null || true)"
    printf '%s' "$PANE" | grep -qE 'for shortcuts|for agents' && { READY=1; break; }
    printf '%s' "$PANE" | grep -q 'Pane is dead' && { echo "$PANE"; fail "Claude Code exited during startup"; }
    sleep 2
  done
  [ "${READY:-0}" = "1" ] || { mtmux capture-pane -p -t "$SID" || true; fail "Claude Code never reached its prompt"; }
  pass "Claude Code is at its prompt"
}

step "a chat message reaches the agent"
THREAD_ID="$(curl -fsS -X POST "$MT/chat" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"ci\",\"memberIds\":[$AGENT_ID]}" | json "d['id']")"

# One message, posted and then waited for. Used twice: once against a running agent, and once
# against one that has to be woken first — the same assertion, so the difference between the two
# runs is only the state the agent was in.
round_trip() {
  MARKER="ci-marker-$1-$RANDOM"
  REPLY="pong-$MARKER"
  script_model_reply "$THREAD_ID" "$REPLY"

  HEARD=0
  curl -fsS -X POST "$MT/chat/$THREAD_ID/messages" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"content\":\"$MARKER\"}" >/dev/null

  # The stronger assertion, and the only one a real Claude Code can make: the agent ANSWERS. The
  # reply has to come back through `microteams api say`, so seeing it in the thread means the whole
  # round trip worked — including the tool door the agent authenticates through. It also means the
  # Enter after the paste actually landed: text sitting un-submitted in the input box looks fine on
  # the pane and produces no reply at all (T-064).
  for _ in $(seq 1 60); do
    if curl -fsS "$MT/chat/$THREAD_ID/messages?page_size=50" -H "$AUTH" | grep -q "$REPLY"; then
      pass "the agent replied in the thread ($1)"; HEARD=1; break
    fi
    sleep 3
  done

  [ "$HEARD" = "1" ] || {
    echo "--- connector log ---"; docker exec "$MACHINE_CT" cat /tmp/connector.log || true
    echo "--- what the pane shows ---"; mtmux capture-pane -p -t "$SID" || true
    echo "--- what the model was asked ---"
    docker exec "$MACHINE_CT" curl -s -X PUT "http://$MOCK_CT:1080/mockserver/retrieve?type=REQUESTS&format=JSON" \
      -d '{"path":"/v1/messages"}' | head -c 2000
    fail "the message never completed its round trip ($1)"
  }
}

round_trip "agent already running"

# --- microteams update: the live-tmux-preserving in-process re-exec (T-025) ----------------------
# `microteams update` on a machine with a LIVE service must take the SIGUSR2 in-process path: the
# service fetches a fresh binary from <origin>/connector/latest/linux-amd64/microteams, verifies it,
# atomically replaces the on-disk self, then syscall.Exec's into the new binary WHILE its tmux (and
# the running agent) stay ALIVE — the new binary RE-ATTACHES to the surviving session. This is the
# OPPOSITE branch from the kill-server test below (tmux death → respawn), and it was untested.
#
# Guarded on UPDATE_MARKER_BIN, which the CI pinned leg sets to a DISTINCTLY-versioned connector
# build; other legs (and standalone bundle runs) have no marker binary and SKIP this gracefully.
# connector/linux-amd64/microteams is bind-mounted into the backend as what it serves at
# /connector/latest/linux-amd64/microteams (deploy/docker-compose.yml), so overwriting it here
# changes what the running service downloads.
#
# Why this is a real assertion and not a false positive: assertion ① (the "signalled to the running
# service" output) rules out the case where the FILE is swapped but the RUNNING service is still the
# old binary — it proves update took the SIGUSR2 in-process path rather than a detached fetch-replace.
# ①+② (the on-disk binary now reports the marker version) together — plus the surviving tmux session
# and a message that still round-trips — indirectly but robustly establish that the running service
# re-execed into the freshly downloaded binary.
if [ -n "${UPDATE_MARKER_BIN:-}" ] && [ -f "${UPDATE_MARKER_BIN:-/nonexistent}" ]; then
  step "microteams update: swap the binary, keep the live screen, re-exec into the NEW build (T-025)"
  # Serve a distinctly-versioned binary so we can prove the running service re-execed into the
  # freshly downloaded one.
  cp "$UPDATE_MARKER_BIN" connector/linux-amd64/microteams
  chmod +x connector/linux-amd64/microteams

  PRE_VER="$(onmachine '$HOME/.local/bin/microteams --version' 2>&1 || true)"

  # Trigger update. It MUST take the in-process SIGUSR2 path (a live service is registered), not a
  # detached fetch-replace.
  UPD_OUT="$(onmachine '$HOME/.local/bin/microteams update --config $HOME/.config/microteams/config.json' 2>&1 || true)"
  printf '%s\n' "$UPD_OUT"
  # ① proves update took the SIGUSR2 in-process path (not a detached fetch-replace of the file).
  printf '%s' "$UPD_OUT" | grep -qi 'signalled to the running service' ||
    fail "microteams update did not signal the live service (took the detached path?) — output: $UPD_OUT"

  # ② Wait for the in-process hand-off: the on-disk binary now reports the marker version.
  NOW_VER=""
  for _ in $(seq 1 30); do
    NOW_VER="$(onmachine '$HOME/.local/bin/microteams --version' 2>&1 || true)"
    printf '%s' "$NOW_VER" | grep -q "$UPDATE_MARKER_VERSION" && break
    sleep 1
  done
  printf '%s' "$NOW_VER" | grep -q "$UPDATE_MARKER_VERSION" ||
    { docker exec "$MACHINE_CT" cat /tmp/connector.log || true; fail "after update the binary is not the freshly downloaded one (want $UPDATE_MARKER_VERSION; pre=$PRE_VER; now=$NOW_VER)"; }

  # The service must still be online (it re-execed, did not die).
  online=""
  for _ in $(seq 1 30); do
    online="$(curl -fsS "$MT/machine/$MACHINE_ID" -H "$AUTH" | json "str(d.get('online',False))")"
    [ "$online" = "True" ] && break
    sleep 1
  done
  [ "$online" = "True" ] || { docker exec "$MACHINE_CT" cat /tmp/connector.log || true; fail "machine went offline across the update"; }

  # The SAME tmux session must still be alive — proving re-attach, not respawn from a killed session.
  mtmux has-session -t "$SID" 2>/dev/null || fail "the live tmux session $SID did not survive microteams update"

  # And a message must still round-trip through the re-adopted screen.
  round_trip "after microteams update"
  pass "update ran in-process, preserved the live screen, and the running service is the freshly downloaded binary"
else
  step "skip microteams update test (no UPDATE_MARKER_BIN — running a leg/bundle without a marker build)"
fi

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

# --- waking a dead agent with a message ----------------------------------------------------------
# The screen is now genuinely gone (the step above killed the server and proved the connector admits
# it). Posting into the thread must therefore bring the agent BACK and still deliver — the backend
# rebuilds the screen, the connector respawns the program, and the applet types the message into a
# terminal that is still repainting its way through a `--resume`.
#
# That last part is the hard half, and it is a bug this project has actually shipped: the message was
# pasted correctly but its Enter was swallowed, so the text sat in the input box and the agent never
# answered (T-064). Nothing about that is visible in a screenshot — the pane looks perfect. Only the
# reply proves it, which is why this asserts the same round trip as above rather than a pane capture.
step "a message wakes a dead agent, and is actually submitted (T-064)"
round_trip "woken by the message"

# --- a long message, in both directions -----------------------------------------------------------
# Long messages have been lost in both directions, silently, for weeks:
#
#   T-058  a long message a PERSON sends is stored and shown to the sender, but never reaches the
#          agent — `tmux send-keys` refused the over-long command and the error went to a log file.
#   T-057  a long message an AGENT sends comes out truncated.
#
# Silent loss is the worst failure this system has, because the sender is told nothing. Both
# directions are asserted here, each where it can actually be seen.
step "a long message survives, in both directions (T-057 / T-058)"

# Inbound (T-058). Many lines rather than one enormous one on purpose: the tty line discipline has
# its own ~4KB limit per line in canonical mode, which would be mistaken for the bug under test. The
# tail marker is what the assertion turns on — a write truncated anywhere loses it.
#
# Read out of what the MODEL was asked, not out of the program's stdin. That is where this moved to
# when the `fake` leg was deleted: the stand-in wrote everything it heard to a file that could be
# compared byte for byte, and real Claude Code cannot be inspected that way. The mock Anthropic API
# in front of it records every request, so the question becomes "did the whole message reach the
# model" — which is a stronger thing to know than "did it reach the program's standard input".
#
# Built as a file and posted with curl like every other request here: python's urllib would honour
# a proxy from the environment, which on a developer machine quietly breaks a localhost call.
python3 -c "
import json
body = '\\n'.join('line%03d %s' % (i, 'x' * 60) for i in range(400)) + '\\nTAIL-MARKER-OK'
open('/tmp/e2e-long.json', 'w').write(json.dumps({'content': body}))"
curl -fsS -X POST "$MT/chat/$THREAD_ID/messages" -H "$AUTH" -H 'Content-Type: application/json' \
  --data-binary @/tmp/e2e-long.json >/dev/null
for _ in $(seq 1 90); do
  if [ "$(verify_model_saw TAIL-MARKER-OK)" = "202" ]; then
    LONG_IN=1; break
  fi
  sleep 2
done
[ "${LONG_IN:-0}" = "1" ] || {
  echo "--- connector log ---"; docker exec "$MACHINE_CT" cat /tmp/connector.log || true
  echo "--- what the pane shows ---"; mtmux capture-pane -p -t "$SID" || true
  fail "a ~25KB message never reached the model (T-058)"
}
pass "a ~25KB message reached the model whole"

# Outbound (T-057). The model is told to post a 20,000-character message; the assertion is on what the
# backend stored, so anything that truncates on the way — the CLI applet, the request, the column —
# fails here.
# The 20,000 characters are composed by a script on the machine rather than inside the tool call:
# a JSON string, inside a mock expectation, inside a shell heredoc is three levels of quoting, and
# what is being tested is message length, not anyone's escaping.
docker exec "$MACHINE_CT" bash -c "cat > /usr/local/bin/longsay <<'EOS'
#!/bin/bash
microteams api say --thread-id \$1 --text \"LONGREPLY-\$(python3 -c 'print(\"y\"*20000)')-END\"
EOS
  chmod +x /usr/local/bin/longsay"
docker exec -i "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/expectation" \
  -H 'Content-Type: application/json' --data-binary @- >/dev/null <<JSON
{ "httpRequest": { "method": "POST", "path": "/v1/messages",
                 "body": { "type": "JSON_PATH", "jsonPath": "\$.tools[?(@.name=='Bash')]" } },
"times": { "remainingTimes": 1, "unlimited": false },
"priority": 20,
"httpLlmResponse": { "provider": "ANTHROPIC", "model": "claude-sonnet-4-5",
  "completion": { "text": "Answering at length.", "streaming": true, "stopReason": "tool_use",
    "toolCalls": [ { "id": "toolu_ci_long", "name": "Bash",
      "arguments": "{\"command\":\"longsay $THREAD_ID\",\"description\":\"long reply\"}" } ],
    "usage": { "inputTokens": 200, "outputTokens": 30 } } } }
JSON
curl -fsS -X POST "$MT/chat/$THREAD_ID/messages" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"content":"say something long"}' >/dev/null
for _ in $(seq 1 60); do
  LEN="$(curl -fsS "$MT/chat/$THREAD_ID/messages?page_size=50" -H "$AUTH" |
    python3 -c "
import json,sys
ms = json.load(sys.stdin)['messages']
print(max([len(m.get('content') or '') for m in ms if 'LONGREPLY-' in (m.get('content') or '')] or [0]))")"
  [ "${LEN:-0}" -ge 20000 ] && { LONG_OUT=1; break; }
  sleep 3
done
[ "${LONG_OUT:-0}" = "1" ] || {
  echo "--- longest LONGREPLY message stored: ${LEN:-0} chars (want >= 20000) ---"
  echo "--- what the pane shows ---"; mtmux capture-pane -p -t "$SID" || true
  fail "the agent's long message was truncated or never arrived (T-057)"
}
pass "the agent's 20,000-character message was stored whole ($LEN chars)"

step "everything asserted"
