#!/usr/bin/env bash
#
# One place to read or set the MicroTeams product version.
#
# The repo-root VERSION file is the single source of truth. This script propagates
# that number into every artifact that must ship it, and — just as importantly —
# leaves alone the versions that are deliberately NOT the product version:
#
#   * the wire-protocol version -> no longer lives here at all: it belongs to micro-connector
#                                   (cli/protocol), pinned in cli/go.mod. It is bumped only on a
#                                   breaking protocol change, and never alongside a product release.
#   * deploy/tmux/build-static-tmux.sh  version=3.5a  -> the third-party tmux we vendor
#   * backend/pom.xml  <parent><version> + <dependency> versions -> upstream libraries
#
# Usage:
#   scripts/version.sh                 # print the current version + verify all files agree
#   scripts/version.sh <X.Y.Z>         # set the product version everywhere
#   scripts/version.sh $(cat VERSION)  # re-propagate the current version (e.g. after an edit)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION_FILE="$ROOT/VERSION"
POM="$ROOT/backend/pom.xml"
API="$ROOT/MicroTeams-API.yml"
APP_PUBSPEC="$ROOT/app/pubspec.yaml"
APPLETS_PKG="$ROOT/applets/package.json"
README="$ROOT/README.md"

# The product version carries an OpenAPI info.version too, but that field only allows
# major.minor by convention here; we derive it as X.Y from the full semver.
semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'

read_current() { tr -d '[:space:]' < "$VERSION_FILE"; }

# ---- read/verify mode -------------------------------------------------------
if [[ $# -eq 0 ]]; then
  cur="$(read_current)"
  echo "product version (VERSION): $cur"
  echo
  echo "as found in each file:"
  printf '  %-28s %s\n' "backend/pom.xml"        "$(perl -0777 -ne 'print "$1\n" if /<artifactId>backend<\/artifactId>\s*<version>([^<]+)<\/version>/' "$POM")"
  printf '  %-28s %s\n' "MicroTeams-API.yml"     "$(perl -ne 'print "$1\n" if /^  version:\s*"?([^"\n]+)"?/' "$API")"
  printf '  %-28s %s\n' "app/pubspec.yaml"       "$(perl -ne 'print "$1\n" if /^version:\s*(\S+)/' "$APP_PUBSPEC")"
  printf '  %-28s %s\n' "applets/package.json"   "$(node -p "require('$APPLETS_PKG').version")"
  echo
  echo "independent (NOT touched by this script):"
  printf '  %-28s %s\n' "micro-connector (protocol)" "$(perl -ne 'print "$1\n" if m{micro-connector/cli (v\S+)}' cli/go.mod)"
  printf '  %-28s %s\n' "vendored tmux"          "$(perl -ne 'print "$1\n" if /^version="?([^"\n]+)"?/' deploy/tmux/build-static-tmux.sh)"
  exit 0
fi

# ---- set mode ---------------------------------------------------------------
new="$1"
if [[ ! "$new" =~ $semver_re ]]; then
  echo "error: version must be X.Y.Z (semver), got: $new" >&2
  exit 1
fi
api_ver="${new%.*}"   # X.Y for the OpenAPI info.version

echo "setting product version -> $new"

# 1. the source of truth
printf '%s\n' "$new" > "$VERSION_FILE"

# 2. backend/pom.xml — ONLY the project <version> (the one right after <artifactId>backend</artifactId>),
#    never the parent or dependency <version> tags.
perl -0777 -i -pe "s{(<artifactId>backend</artifactId>\s*<version>)[^<]+(</version>)}{\${1}$new\${2}}" "$POM"

# 3. OpenAPI contract — info.version (indented two spaces, unique in the file)
perl -i -pe "s{^(  version:\s*).*}{\${1}\"$api_ver\"}" "$API"

# 4. applets/package.json — set top-level .version via node (leaves the rest untouched)
node -e "const f='$APPLETS_PKG';const p=require(f);p.version='$new';require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n')"

# 5. app/pubspec.yaml — the `version:` line at column 0, which is the app's own and not a
#    dependency constraint. app/package.json carries the same number for the browser checks.
perl -i -pe "s{^version:\s*\S+}{version: $new}" "$APP_PUBSPEC"
node -e "const f='$ROOT/app/package.json';const p=require(f);p.version='$new';require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n')"

# 6. README — the example run command references the built jar (backend-<version>.jar)
perl -i -pe "s{(microteams|backend)-[0-9]+\.[0-9]+\.[0-9]+\.jar}{backend-$new.jar}g" "$README"

echo "done. verifying:"
exec "$0"
