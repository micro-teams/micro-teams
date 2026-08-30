#!/usr/bin/env bash
#
#  Description: Putting a real Claude Code on a machine container, and scripting what the model
#               says back. Sourced by both harnesses that need it.
#
#               There is one copy because there is one answer. `.github/scripts/e2e.sh` drives the
#               machinery with curl and `app/tool/e2e/run.sh` drives the whole product through the
#               interface, but "install the agent's program and put a mock Anthropic API in front of
#               it" is the same paragraph either way — and it was the reason a stand-in `claude`
#               existed at all: a second implementation is cheaper to keep than to share, right up
#               until the two drift.
#
#               The callers provide: fail(), MACHINE_CT, MOCK_CT, NET, MACHINE_USER, and onmachine().
#
#  Author(s):
#      Nictheboy Li    <nictheboy@outlook.com>

# Real Claude Code, pointed at a mock Anthropic API. API mode (a token + a base URL) is what keeps
# this out of the OAuth flow entirely — no browser, no login, nothing to approve.
install_agent_program() {
  local leg="$1"
  case "$leg" in
    npm:*|installer) ;;
    *) fail "unknown leg: $leg" ;;
  esac

  docker rm -f "$MOCK_CT" >/dev/null 2>&1 || true
  docker run -d --name "$MOCK_CT" --hostname "$MOCK_CT" --network "$NET" \
    mockserver/mockserver:mockserver-7.5.0 >/dev/null

  # Already there? Then this machine was started from an image that has it, and installing again is
  # a download for nothing. That is the whole reason for this branch — it makes a pre-built machine
  # image usable (see MT_E2E_MACHINE_IMAGE), which is worth having when many runs happen in a row.
  #
  # It was first written with a different justification: node and Claude had failed all three
  # attempts on one host, and the comment here blamed that host's route to the registry. It was not
  # the host — the network was wobbling everywhere that afternoon, and the same install worked first
  # try once it settled. The change is still right; the reason it was given was invented, and an
  # invented cause in a comment is the same failure as a test that lies.
  if docker exec "$MACHINE_CT" bash -lc 'command -v claude' >/dev/null 2>&1; then
    echo -n "claude already on the machine: "; onmachine 'claude --version'
    _write_anthropic_env
    return 0
  fi

  # Retried: these reach the public internet, and a registry blip should not be reported as a
  # product failure.
  local attempt
  for attempt in 1 2 3; do
    docker exec "$MACHINE_CT" bash -c "set -e
      export DEBIAN_FRONTEND=noninteractive
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
      apt-get install -y -qq nodejs >/dev/null" && break
    echo "  (node install attempt $attempt failed, retrying)"; sleep 5
  done

  case "$leg" in
    npm:*) for attempt in 1 2 3; do
             docker exec "$MACHINE_CT" npm i -g "@anthropic-ai/claude-code@${leg#npm:}" >/dev/null 2>&1 && break
             echo "  (claude install attempt $attempt failed, retrying)"; sleep 5
           done ;;
    *)     for attempt in 1 2 3; do
             onmachine 'curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1' && break
             echo "  (claude installer attempt $attempt failed, retrying)"; sleep 5
           done ;;
  esac

  _write_anthropic_env
  echo -n "claude on the machine: "; onmachine 'claude --version' || fail "Claude Code did not install"
}

# The agent's program is launched through `bash -lc` by our driver, so the login shell is where its
# environment has to come from — the same place a real deployment would put a proxy. Written every
# time, including when the program came pre-installed, because the mock's address is this run's.
_write_anthropic_env() {
  docker exec "$MACHINE_CT" bash -c "cat > /etc/profile.d/anthropic.sh <<EOF
export ANTHROPIC_BASE_URL=http://$MOCK_CT:1080
export ANTHROPIC_AUTH_TOKEN=sk-ant-ci-not-a-real-key
export ANTHROPIC_MODEL=claude-sonnet-4-5
export DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
EOF"
  onmachine 'mkdir -p ~/.claude && printf "{\"hasCompletedOnboarding\":true}" > ~/.claude.json'
}

# Called AFTER the machine has joined the network the mock is on — not at the end of the install,
# which is where it was first put and where it could only ever time out: the machine cannot reach
# the mock until it is on the same network, and joining happens later.
wait_for_mock() {
  local attempt
  for attempt in $(seq 1 30); do
    docker exec "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/status" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "the mock Anthropic API never came up"
}

# Script the model: when Claude Code sends the conversation request (the one carrying its tool list),
# answer with a Bash tool call that posts a reply as the agent.
#
# Matching on the tool list matters — Claude Code also asks this endpoint for a session title, with
# no tools, and a once-only expectation would otherwise be spent on that. `streaming` is not optional
# either: a non-streamed tool call is silently ignored by Claude Code, which looks exactly like
# nothing happening.
script_model_reply() {
  local thread_id="$1" reply="$2"
  docker exec -i "$MACHINE_CT" curl -fsS -X PUT "http://$MOCK_CT:1080/mockserver/expectation" \
    -H 'Content-Type: application/json' --data-binary @- >/dev/null <<JSON
{ "httpRequest": { "method": "POST", "path": "/v1/messages",
                   "body": { "type": "JSON_PATH", "jsonPath": "\$.tools[?(@.name=='Bash')]" } },
  "times": { "remainingTimes": 1, "unlimited": false },
  "priority": 10,
  "httpLlmResponse": { "provider": "ANTHROPIC", "model": "claude-sonnet-4-5",
    "completion": { "text": "Answering the group.", "streaming": true, "stopReason": "tool_use",
      "toolCalls": [ { "id": "toolu_ci_reply", "name": "Bash",
        "arguments": "{\"command\":\"microteams api say --thread-id $thread_id --text '$reply'\",\"description\":\"reply\"}" } ],
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
}

# Did the model ever receive a request whose body contains this?
#
# Asked with `verify` rather than by downloading the request log and grepping it: that log is over a
# megabyte once a 25KB conversation is in it, and pulling it repeatedly spends the whole budget on
# transfers rather than on waiting. `verify` answers 202 when some request matched and 406 when none
# did, and says nothing else.
#
# Four backslashes, not two: this heredoc is unquoted (it has to interpolate), so the shell eats one
# level before curl ever sees it. Two would put `\s` in the JSON — not a valid JSON escape — and the
# matcher silently degrades into something that never matches, which looks exactly like a message
# that never arrived. It cost a run to find that out.
verify_model_saw() {
  docker exec -i "$MACHINE_CT" curl -s -o /dev/null -w '%{http_code}' \
    -X PUT "http://$MOCK_CT:1080/mockserver/verify" -H 'Content-Type: application/json' \
    --data-binary @- <<VERIFY
{"httpRequest": {"method":"POST","path":"/v1/messages",
                 "body":{"type":"REGEX","regex":"[\\\\s\\\\S]*$1[\\\\s\\\\S]*"}},
 "times": {"atLeast": 1}}
VERIFY
}
