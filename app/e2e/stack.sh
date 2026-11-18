#!/usr/bin/env bash
# Brings an unpacked deployment bundle up for a journey: the stack on port 80, cheese-auth mailing
# into the mail sink, and the sink's HTTP side on :52027 so the journey can read sign-up codes.
#
# Usage: stack.sh <unpacked microteams-deploy dir>
#
# Port 80 because the backend derives its own origin from the forwarded host without a port, and
# a browser's origin on any other port does not match it.
set -euo pipefail
BUNDLE="$(cd "$1" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIL_CT=e2e-mailsink
SMTP_PORT=52026 MAIL_PORT=52027

cd "$BUNDLE"
# Fresh secrets only for a fresh bundle: new ones over an existing app_data/ lock Postgres out.
[ -f .env ] || bash gen-env.sh >/dev/null
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
docker compose -p e2e up -d --wait cheese-auth
curl -fsS -o /dev/null http://localhost/mt/lines
echo "stack up on :80, mail on :$MAIL_PORT"
