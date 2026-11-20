#!/usr/bin/env bash
# Brings an unpacked deployment bundle up for a journey: the stack on port 80, three lines to it,
# cheese-auth mailing into the mail sink, and the sink's HTTP side on :52027 so the journey can read
# sign-up codes.
#
# Usage: stack.sh <unpacked microteams-deploy dir>
#
# Port 80 because the backend derives its own origin from the forwarded host without a port, and
# a browser's origin on any other port does not match it.
#
# The lines: "direct" is nginx itself (http://localhost), "b" and "c" are http://localhost:8081 and
# :8082, two forwarders to nginx in the container e2e-lines (lines.py), whose faults a journey sets
# through its control port, :8090. Every client reaches them under these names: a browser on this
# host directly, the Android emulator through `adb reverse`, the machine through forwarders of its
# own (machine.sh).
set -euo pipefail
BUNDLE="$(cd "$1" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIL_CT=e2e-mailsink LINES_CT=e2e-lines
SMTP_PORT=52026 MAIL_PORT=52027

cd "$BUNDLE"
# Fresh secrets only for a fresh bundle: new ones over an existing app_data/ lock Postgres out.
[ -f .env ] || bash gen-env.sh >/dev/null
mkdir -p multipath
cat > multipath/lines.json <<'JSON'
{"lines": [
  {"id": "direct", "url": "http://localhost"},
  {"id": "b", "url": "http://localhost:8081"},
  {"id": "c", "url": "http://localhost:8082"}
]}
JSON
# A downloaded artifact does not keep the executable bit.
chmod +x multipath/multipath-server
sed -i \
  -e "s/^EMAIL_SMTP_HOST=.*/EMAIL_SMTP_HOST=$MAIL_CT/" \
  -e "s/^EMAIL_SMTP_PORT=.*/EMAIL_SMTP_PORT=$SMTP_PORT/" \
  -e "s|^EMAIL_DEFAULT_FROM=.*|EMAIL_DEFAULT_FROM=MicroTeams <no-reply@example.com>|" .env
grep -q '^NGINX_HTTP_PORT=' .env || echo "NGINX_HTTP_PORT=80" >> .env
sed -i "s/^NGINX_HTTP_PORT=.*/NGINX_HTTP_PORT=80/" .env
docker compose -p e2e up -d --wait
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose -p e2e ps -q nginx)")"
docker rm -f "$MAIL_CT" >/dev/null 2>&1 || true
docker run -d --name "$MAIL_CT" --network "$NET" -p "$MAIL_PORT:$MAIL_PORT" \
  -v "$HERE/mailsink.py:/mailsink.py:ro" python:3.12-slim \
  python /mailsink.py --smtp-port "$SMTP_PORT" --http-port "$MAIL_PORT" --bind 0.0.0.0 >/dev/null
for _ in $(seq 1 30); do curl -fsS "http://localhost:$MAIL_PORT/messages" >/dev/null 2>&1 && break; sleep 1; done
docker rm -f "$LINES_CT" >/dev/null 2>&1 || true
docker run -d --name "$LINES_CT" --network "$NET" -p 8081:8081 -p 8082:8082 -p 8090:8090 \
  -v "$HERE/lines.py:/lines.py:ro" python:3.12-slim \
  python /lines.py --line 8081=nginx:80 --line 8082=nginx:80 --control 8090 >/dev/null
docker compose -p e2e up -d --wait cheese-auth
for line in http://localhost http://localhost:8081 http://localhost:8082; do
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "$line/multipath/v3/lines" && break; sleep 1; done
  curl -fsS -o /dev/null "$line/multipath/v3/lines"
done
echo "stack up on :80, lines on :80 :8081 :8082 (faults on :8090), mail on :$MAIL_PORT"
