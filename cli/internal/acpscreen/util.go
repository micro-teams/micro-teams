package acpscreen

import (
	"strings"
	"unicode/utf8"
)

func hasPrefix(s, p string) bool { return strings.HasPrefix(s, p) }

// isPrefixOf reports whether s is a proper beginning of whole — an escape sequence cut off by the
// end of a read.
func isPrefixOf(s, whole string) bool { return len(s) < len(whole) && strings.HasPrefix(whole, s) }

func trimSpace(s string) string { return strings.TrimSpace(s) }

// decodeRune decodes one rune; a byte that is not valid UTF-8 is passed through as itself so
// nothing typed is silently lost.
func decodeRune(b []byte) (rune, int) {
	r, size := utf8.DecodeRune(b)
	if r == utf8.RuneError && size <= 1 {
		return rune(b[0]), 1
	}
	return r, size
}
