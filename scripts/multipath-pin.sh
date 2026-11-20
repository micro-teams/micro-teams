#!/usr/bin/env bash
#
# One place to pin the multipath commit everything here is built from.
#
# The Go side (cli/go.mod) requires github.com/micro-teams/multipath/go at that commit's
# pseudo-version; the CLI, multipath-client and multipath-server are all built from it. The
# JavaScript side has no published package for an unreleased commit, so the package is built from the
# same commit and kept in the repository as app/vendor/micro-teams-multipath-<commit>.tgz, which
# app/package.json names. The package's content is reproducible (the build uses the commit's own
# lock file), so CI rebuilds it and refuses a vendored one whose files differ.
#
# Usage:
#   scripts/multipath-pin.sh <commit>   pin cli/go.mod and app/ to that multipath commit
#   scripts/multipath-pin.sh --check    rebuild the package from the commit cli/go.mod pins and fail
#                                       unless its files are the vendored tarball's, and unless
#                                       app/package.json and its lock file name it
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO=https://github.com/micro-teams/multipath.git
MODULE=github.com/micro-teams/multipath/go

# build <commit> <out dir>: the npm package of that commit, as <out dir>/micro-teams-multipath-<commit12>.tgz
build() {
  local commit="$1" out="$2" work
  work="$(mktemp -d)"
  git -C "$work" init -q
  git -C "$work" fetch -q --depth 1 "$REPO" "$commit"
  git -C "$work" checkout -q FETCH_HEAD
  (cd "$work/js" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm run -s build >/dev/null &&
    npm pack -s --pack-destination "$work" >/dev/null)
  mv "$work"/micro-teams-multipath-*.tgz "$out/micro-teams-multipath-${commit:0:12}.tgz"
  rm -rf "$work"
}

# pinned: the full hash of the commit cli/go.mod pins (a pseudo-version carries only 12 digits).
pinned() {
  (cd "$ROOT/cli" && go mod download -json "$MODULE@$(go list -m -f '{{.Version}}' "$MODULE")") |
    sed -n 's/.*"Hash": "\([0-9a-f]\{40\}\)".*/\1/p'
}

case "${1:-}" in
--check)
  full="$(pinned)"
  commit="${full:0:12}"
  want="app/vendor/micro-teams-multipath-$commit.tgz"
  [ -f "$ROOT/$want" ] || { echo "cli/go.mod pins $commit, but $want is missing: run scripts/multipath-pin.sh $commit" >&2; exit 1; }
  grep -q "\"file:vendor/micro-teams-multipath-$commit.tgz\"" "$ROOT/app/package.json" ||
    { echo "app/package.json does not name $want" >&2; exit 1; }
  grep -q "vendor/micro-teams-multipath-$commit.tgz" "$ROOT/app/package-lock.json" ||
    { echo "app/package-lock.json does not name $want: run npm install in app/" >&2; exit 1; }
  others="$(cd "$ROOT/app/vendor" && ls micro-teams-multipath-*.tgz | grep -v "^micro-teams-multipath-$commit.tgz$" || true)"
  [ -z "$others" ] || { echo "stale packages in app/vendor: $others" >&2; exit 1; }
  out="$(mktemp -d)"
  build "$full" "$out"
  mkdir "$out/built" "$out/vendored"
  tar -xzf "$out/micro-teams-multipath-$commit.tgz" -C "$out/built"
  tar -xzf "$ROOT/$want" -C "$out/vendored"
  diff -r "$out/built" "$out/vendored" >&2 || { echo "$want is not what multipath $commit builds to" >&2; exit 1; }
  rm -rf "$out"
  echo "multipath $commit: cli/go.mod and $want agree"
  ;;
"" | -*)
  echo "usage: $0 <commit> | --check" >&2
  exit 2
  ;;
*)
  (cd "$ROOT/cli" && go get "$MODULE@$1" && go mod tidy)
  full="$(pinned)"
  commit="${full:0:12}"
  mkdir -p "$ROOT/app/vendor"
  rm -f "$ROOT"/app/vendor/micro-teams-multipath-*.tgz
  build "$full" "$ROOT/app/vendor"
  (cd "$ROOT/app" && npm install --no-audit --no-fund "@micro-teams/multipath@file:vendor/micro-teams-multipath-$commit.tgz")
  echo "pinned multipath $commit"
  ;;
esac
