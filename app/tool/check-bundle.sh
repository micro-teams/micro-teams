#!/usr/bin/env bash
#
#  Description: Stands the shipped bundle up behind the shipped gateway and runs the browser checks.
#
#               The gateway is deploy/nginx.conf in the nginx image — the file that ships, not a
#               description of it. That is the whole point: T-093 got through because the layout was
#               only ever assembled by a production deploy, and the only browser check ran against
#               `build/web` served at the root, which nobody is served.
#
#               The upstreams nginx proxies to are containers on a private network with the names
#               the config names (cheese-auth, backend, origin), because nginx resolves those at
#               startup and refuses to start without them — and because binding their ports on the
#               host collides with whatever the developer already has running there.
#
#               Expects `flutter build web` plus tool/launcher.mjs and tool/make-sw.mjs to have run,
#               exactly as tool/check-web.sh does.
#
#  Author(s):
#      Nictheboy Li    <nictheboy@outlook.com>
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(dirname "$HERE")"
REPO="$(dirname "$APP")"
WEB_BUILD="${CHECK_BUNDLE_WEB:-$APP/build/web}"
PORT="${CHECK_BUNDLE_PORT:-58090}"
NET="mt-bundle-check-net"
GATEWAY="mt-bundle-check-nginx"
# A SECOND gateway, serving the same tree from its own port, so it is a genuinely different origin
# to the browser — that is what makes it a line. Its own container because its access log is then
# the evidence: if the worker raced, this is where the requests it did not need show up.
GATEWAY2="mt-bundle-check-nginx-2"
UPSTREAMS="mt-bundle-check-upstreams"
PORT2="${CHECK_BUNDLE_PORT2:-$((${CHECK_BUNDLE_PORT:-58090} + 2))}"
# And a line with nothing behind it, because a published line that is simply down must cost
# redundancy and nothing else.
PORT_DEAD="${CHECK_BUNDLE_PORT_DEAD:-$((${CHECK_BUNDLE_PORT:-58090} + 3))}"

# Docker leftovers from an interrupted run, cleared before starting and again on the way out. The
# scratch directory is NOT part of this: it is made below, and a previous version of this script
# called the whole cleanup upfront and deleted the directory it had just created. That survived
# locally only because assembling recreated it on the way past, and failed in CI, where the bundle
# arrives already assembled and nothing recreates anything.
clear_containers() {
  docker rm -f "$GATEWAY" "$GATEWAY2" "$UPSTREAMS" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
clear_containers

WORK="$(mktemp -d)"
cleanup() {
  clear_containers
  rm -rf "$WORK"
}
trap cleanup EXIT

# CI passes the tree the release workflow actually assembled, so what is opened here is the bundle
# that ships rather than a second assembly of the same inputs. Locally there is no bundle yet, so
# assemble one from the web build — the same function the workflow calls.
if [ -n "${CHECK_BUNDLE_DIST:-}" ]; then
  SERVE="$(cd "$CHECK_BUNDLE_DIST" && pwd)"
  echo "serving the assembled bundle at $SERVE"
else
  if [ ! -f "$WEB_BUILD/index.html" ]; then
    echo "no web build at $WEB_BUILD — run: flutter build web --release" >&2
    exit 1
  fi
  node "$HERE/assemble-dist.mjs" "$WEB_BUILD" "$REPO/site" "$WORK/dist"
  SERVE="$WORK/dist"
fi

docker network create "$NET" >/dev/null

# node:22-alpine rather than the host's node: the gateway reaches these by container name, and a
# container is the only thing a container name resolves to.
docker run -d --name "$UPSTREAMS" --network "$NET" \
  --network-alias cheese-auth --network-alias backend --network-alias origin \
  -e "MT_LINES=http://127.0.0.1:$PORT2,http://127.0.0.1:$PORT_DEAD" \
  -v "$HERE/bundle-upstreams.mjs:/bundle-upstreams.mjs:ro" \
  node:22-alpine node /bundle-upstreams.mjs >/dev/null

docker run -d --name "$GATEWAY" --network "$NET" -p "$PORT:80" \
  -v "$REPO/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$SERVE:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null

docker run -d --name "$GATEWAY2" --network "$NET" -p "$PORT2:80" \
  -v "$REPO/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$SERVE:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null

wait_for_gateway() {
  for _ in $(seq 1 30); do
    # --noproxy: a proxy in the environment happily intercepts a loopback request and resets it,
    # which reads as "the gateway never came up". Same trap as tool/check-web.sh.
    curl -sf --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" && return 0
    sleep 1
  done
  echo "the gateway never came up; its log:" >&2
  docker logs "$GATEWAY" >&2 || true
  return 1
}

wait_for_gateway

export CHECK_BUNDLE_BASE="http://127.0.0.1:$PORT"
export CHECK_BUNDLE_LINE2="http://127.0.0.1:$PORT2"
export CHECK_BUNDLE_LINE2_CONTAINER="$GATEWAY2"
export CHECK_BUNDLE_LINE_DEAD="http://127.0.0.1:$PORT_DEAD"
node "$HERE/check-bundle.mjs"

# ── and the one deploy where the worker's scope changes ───────────────────────────────────────
#
# Everybody currently carries a worker registered at "/", and a worker at a different scope does not
# replace it — the launcher's version guard is what has to clear it. See tool/check-upgrade.mjs.
#
# The "before" tree is this same app served the old way: at the root, with its base pointed back at
# "/" and its own build stamp, so the guard sees a genuine version change rather than a no-op.
echo
echo "== the upgrade from the deployment that is live today =="
OLD="$WORK/old"
cp -r "$SERVE/app" "$OLD"
sed -i 's#<base href="/app/">#<base href="/">#' "$OLD/index.html" "$OLD/app.html"
node "$HERE/fake-deploy.mjs" "$OLD" "was-live-$(date +%s)" >/dev/null
export CHECK_UPGRADE_PROFILE="$WORK/profile"

docker rm -f "$GATEWAY" >/dev/null 2>&1 || true
docker run -d --name "$GATEWAY" --network "$NET" -p "$PORT:80" \
  -v "$HERE/upgrade-from/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$OLD:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null
wait_for_gateway
node "$HERE/check-upgrade.mjs" before

# The deploy itself: the same origin, the same browser profile, a different gateway and tree.
docker rm -f "$GATEWAY" >/dev/null 2>&1 || true
docker run -d --name "$GATEWAY" --network "$NET" -p "$PORT:80" \
  -v "$REPO/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$SERVE:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null
wait_for_gateway
node "$HERE/check-upgrade.mjs" after
