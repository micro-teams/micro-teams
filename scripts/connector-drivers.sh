#!/usr/bin/env bash
#
# Builds the screen drivers from the micro-connector commit cli/go.mod pins.
#
# A driver and the connector that runs it are two halves of one program: the driver calls the applet
# API the connector embeds, and both come from the same micro-connector commit, where its own
# end-to-end test runs them together. So the drivers are not a dependency of their own here. The
# version of github.com/micro-teams/micro-connector/cli in cli/go.mod is the only pin; this script
# resolves it to its commit (a release tag and a branch pseudo-version alike), builds that commit's
# applets/, and copies the drivers out. Bumping the connector bumps the drivers, and nothing can pin
# one without the other.
#
# Usage:
#   scripts/connector-drivers.sh <out dir>   write claude.js, codex.js, pi.js and dsh.js into <out dir>
#
# Needs go (to resolve the pin), git, node and npm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE=github.com/micro-teams/micro-connector/cli
DRIVERS=(claude codex pi dsh)

out="${1:?usage: connector-drivers.sh <out dir>}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

version="$(cd "$ROOT/cli" && go list -m -f '{{.Version}}' "$MODULE")"
origin="$(cd "$ROOT/cli" && go mod download -json "$MODULE@$version")"
repo="$(printf '%s' "$origin" | sed -n 's/.*"URL": "\([^"]*\)".*/\1/p')"
commit="$(printf '%s' "$origin" | sed -n 's/.*"Hash": "\([0-9a-f]\{40\}\)".*/\1/p')"
[ -n "$repo" ] && [ -n "$commit" ] || { echo "cannot resolve $MODULE@$version to a commit" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
git -C "$work" fetch -q --depth 1 "$repo" "$commit"
git -C "$work" checkout -q FETCH_HEAD
(cd "$work/applets" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && node build.mjs >/dev/null)

for name in "${DRIVERS[@]}"; do
  cp "$work/applets/dist/$name.js" "$out/$name.js"
  echo "screen driver: $name.js <- micro-connector $version (${commit:0:12})"
done
