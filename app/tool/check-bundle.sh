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
UPSTREAMS="mt-bundle-check-upstreams"

WORK="$(mktemp -d)"
cleanup() {
  docker rm -f "$GATEWAY" "$UPSTREAMS" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup

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
  -v "$HERE/bundle-upstreams.mjs:/bundle-upstreams.mjs:ro" \
  node:22-alpine node /bundle-upstreams.mjs >/dev/null

docker run -d --name "$GATEWAY" --network "$NET" -p "$PORT:80" \
  -v "$REPO/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$SERVE:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null

for _ in $(seq 1 30); do
  # --noproxy: a proxy in the environment happily intercepts a loopback request and resets it,
  # which reads as "the gateway never came up". Same trap as tool/check-web.sh.
  curl -sf --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done

if ! curl -sf --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "the gateway never came up; its log:" >&2
  docker logs "$GATEWAY" >&2 || true
  exit 1
fi

CHECK_BUNDLE_BASE="http://127.0.0.1:$PORT" node "$HERE/check-bundle.mjs"
