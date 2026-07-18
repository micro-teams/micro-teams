#!/usr/bin/env bash
#
#  Description: Starts the dependencies our integration tests need — one Postgres
#               (shared: cheese-auth owns the "public" tables, nt owns "microteams") and
#               the real cheese-auth service. Mirrors the local docker-compose
#               setup. Called by CI and usable locally. Credentials here are
#               test-only and match backend/src/main/resources/application.properties.
#
#  Author(s):
#       Nictheboy Li    <nictheboy@outlook.com>
#
set -euo pipefail

DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=postgres
JWT_SECRET=test-secret
AUTH_PORT=8091
AUTH_IMAGE=ghcr.io/sageseekersociety/cheese-auth:main

docker network create cheese_network 2>/dev/null || true

echo "== Starting Postgres =="
docker rm -f postgres 2>/dev/null || true
docker run -d \
    --name postgres \
    --network cheese_network \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    --health-cmd="pg_isready -U $DB_USER" \
    --health-interval=5s --health-timeout=5s --health-retries=20 \
    -p 5432:5432 \
    postgres:16.2

until docker exec postgres pg_isready -U "$DB_USER" >/dev/null 2>&1; do sleep 2; done

# nt's own tables live in the "microteams" schema; cheese-auth only owns "public".
docker exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS microteams;"

echo "== Starting cheese-auth =="
docker rm -f microteams_auth 2>/dev/null || true
docker pull "$AUTH_IMAGE"
# The image runs `prisma db push` on first start, gated on a flag file under
# FILE_UPLOAD_PATH — so that env must be set or the schema is never created.
# DEFAULT_AVATAR_NAME makes it seed its default avatar (id=1) on start, which the
# test user-creator attaches every profile to. The container's own /status
# healthcheck is the readiness signal (its image ships curl).
docker run -d \
    --name microteams_auth \
    --network cheese_network \
    -e DB_HOST=postgres -e DB_PORT=5432 -e DB_NAME="$DB_NAME" -e POSTGRES_DB="$DB_NAME" \
    -e DB_USERNAME="$DB_USER" -e DB_PASSWORD="$DB_PASSWORD" \
    -e PRISMA_DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@postgres:5432/$DB_NAME?schema=public&connection_limit=16" \
    -e JWT_SECRET="$JWT_SECRET" \
    -e PORT="$AUTH_PORT" \
    -e FILE_UPLOAD_PATH=/app/uploads \
    -e DEFAULT_AVATAR_NAME=default.jpg \
    -e COOKIE_BASE_URL=/ \
    -e FRONTEND_BASE_URL=http://localhost \
    -e EMAIL_SMTP_PORT=25 \
    --health-cmd="curl -fsS http://localhost:$AUTH_PORT/status || exit 1" \
    --health-interval=5s --health-timeout=5s --health-retries=40 --health-start-period=15s \
    -p "$AUTH_PORT:$AUTH_PORT" \
    "$AUTH_IMAGE"

echo "== Waiting for cheese-auth to become healthy =="
for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' microteams_auth 2>/dev/null || echo starting)
    if [ "$status" = "healthy" ]; then
        echo "cheese-auth is ready"
        exit 0
    fi
    if [ "$(docker inspect -f '{{.State.Status}}' microteams_auth)" = "exited" ]; then
        docker logs microteams_auth
        echo "cheese-auth exited unexpectedly" >&2
        exit 1
    fi
    sleep 3
done

docker logs microteams_auth
echo "cheese-auth did not become healthy in time" >&2
exit 1
