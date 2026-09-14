# The mark

`logo.svg` is the source. Everything else — the favicon, the web icons, the Android launcher icons,
the adaptive icon's foreground — is generated from it by `tool/icons.mjs`, so there is exactly one
file to change and no set of icons that can quietly disagree with another.

A person and an agent, inside the shape everyone reads as "a conversation". Nothing here is a
metaphor: the two figures are what the product is about, and they are drawn with the glyphs people
already know — the account silhouette, and the square-headed robot Android and Reddit made ordinary.

Green `#07C160` on white, which is the green the send button already uses (`sendGreen` in
`lib/src/common/ui/theme.dart`). The Android adaptive icon puts the mark on the app's own `#060606`
rather than on the green, because a launcher already places it against the wallpaper and a green
tile inside a green circle is a green blob.
