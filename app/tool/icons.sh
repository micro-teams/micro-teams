#!/usr/bin/env bash
# The launcher icons, rendered from assets/logo.svg, the one source of the mark:
#
#   assets/icon.png           1024 px: the mark on its rounded green tile, for a launcher that
#                             takes a plain icon
#   assets/adaptive-icon.png  1024 px: the mark alone on transparency, placed as on Android's 108dp
#                             adaptive canvas (inside the middle part a launcher's mask always
#                             keeps); app.json sets it on the tile's green
#
# Usage: bash tool/icons.sh   (needs rsvg-convert). The PNGs are committed: a build reads them.
set -euo pipefail
cd "$(dirname "$0")/.."
rsvg-convert -w 1024 -h 1024 assets/logo.svg -o assets/icon.png
{
  echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 108 108\"><g transform=\"translate(10.8 10.8) scale(0.16875)\">"
  grep -v -e "<svg" -e "</svg>" -e "<rect width=\"512\"" assets/logo.svg
  echo "</g></svg>"
} | rsvg-convert -w 1024 -h 1024 -o assets/adaptive-icon.png
