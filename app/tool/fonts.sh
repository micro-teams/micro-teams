#!/usr/bin/env bash
# The Chinese face of the web build, cut from Noto Sans SC Regular (the release pinned below):
#
#   public/fonts/NotoSansSC-Common.woff2   GB 2312's characters (the 6763 hanzi in everyday use and
#                                          its symbols), plus the kana, CJK punctuation, radicals and
#                                          fullwidth forms the font has, as woff2: about 1.5 MB
#                                          against the whole font's 8.3 MB
#
# A character it does not have is drawn by the system's own CJK font, the next face in the app's
# font stack (src/ui/theme.ts), so a rare character still renders, in another face.
#
# Usage: bash tool/fonts.sh   (needs curl, python3 and uvx). The woff2 is committed: a build reads it.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
SHA256=faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/NotoSansSC-Regular.otf" "$SRC"
echo "$SHA256  $work/NotoSansSC-Regular.otf" | sha256sum -c --quiet
python3 - >"$work/unicodes" <<'EOF'
gb2312 = set()
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            gb2312.add(ord(bytes([hi, lo]).decode("gb2312")))
        except UnicodeDecodeError:
            pass
print(",".join(f"U+{c:04X}" for c in sorted(gb2312)))
print("U+2E80-2FDF,U+3000-303F,U+3040-30FF,U+3100-312F,U+31A0-31FF,U+FE30-FE4F,U+FF00-FFEF")
EOF
uvx --with brotli==1.2.0 --from fonttools==4.68.0 pyftsubset "$work/NotoSansSC-Regular.otf" \
  --unicodes-file="$work/unicodes" --flavor=woff2 --output-file=public/fonts/NotoSansSC-Common.woff2
ls -l public/fonts/NotoSansSC-Common.woff2
