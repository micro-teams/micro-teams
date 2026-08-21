#!/usr/bin/env bash
# Generate the Dart API client from the repo-root contract.
#
# This is the Dart half of what frontend/package.json's "codegen" script does for TypeScript:
# same MicroTeams-API.yml, same generator, so `chatApi.listChats()` here and ChatApi.listChats in
# the backend stay two ends of one definition. The output is gitignored on purpose — a generated
# file that can be edited is a generated file that will be edited.
#
# Run it before build/test. CI runs it too (see .github/workflows/build.yml).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$here/.." && pwd)"
out="$here/packages/mt_api"

# Run from app/, so the pinned generator version in app/openapitools.json is the one used. An
# unpinned npx would silently follow whatever is newest, and a generator that changes under you is
# a contract that changes under you.
cd "$here"

npx --yes @openapitools/openapi-generator-cli generate \
  -i "$repo/MicroTeams-API.yml" \
  -g dart-dio \
  -o "$out" \
  --additional-properties=serializationLibrary=json_serializable,pubName=mt_api \
  >/dev/null

# The generator pins an SDK floor older than the one json_serializable's own output needs
# (null-aware elements). Left alone, codegen "succeeds" and every model fails to format, which
# reads as a formatter bug rather than as a version constraint.
sed -i "s|sdk: '>=3.5.0 <4.0.0'|sdk: '^3.9.0'|" "$out/pubspec.yaml"

cd "$out"
flutter pub get >/dev/null
dart run build_runner build --delete-conflicting-outputs >/dev/null
echo "mt_api generated"
