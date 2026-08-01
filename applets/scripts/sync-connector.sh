#!/usr/bin/env bash
# Vendors the screen engine from micro-connector at a pinned commit.
#
# The engine is shared with the other products that drive the same programs, so it is maintained in
# one place: https://github.com/micro-teams/micro-connector. It is vendored rather than depended on
# because a machine's connector must be able to build from this repository alone, and because the
# whole point of pinning is that a fix arrives when we take it, not when someone else pushes.
#
# Usage: sync-connector.sh [<commit>]   (default: the pin recorded below)
set -euo pipefail
PIN="${1:-bab515d4126e62189f9d044b3cf2ecb49023efe6}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/screen/engine"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q https://github.com/micro-teams/micro-connector "$TMP/mc"
git -C "$TMP/mc" checkout -q "$PIN"
rm -f "$DEST"/*.ts
cp "$TMP/mc"/applets/src/engine/*.ts "$DEST/"
echo "engine synced from micro-connector@$PIN"
