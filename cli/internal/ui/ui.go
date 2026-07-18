// Package ui is a tiny, dependency-light helper for pretty terminal output:
// colors, a heading, and aligned key/value rows. Colors switch off automatically
// when stdout is not a terminal or NO_COLOR is set, so piped output stays clean.
package ui

import (
	"fmt"
	"os"

	"golang.org/x/term"
)

var enabled = term.IsTerminal(int(os.Stdout.Fd())) && os.Getenv("NO_COLOR") == ""

func paint(code, s string) string {
	if !enabled {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

// Color/style helpers.
func Bold(s string) string   { return paint("1", s) }
func Dim(s string) string    { return paint("2", s) }
func Red(s string) string    { return paint("31", s) }
func Green(s string) string  { return paint("32", s) }
func Yellow(s string) string { return paint("33", s) }
func Cyan(s string) string   { return paint("36", s) }

// Accent is the brand color used for headings and highlights.
func Accent(s string) string { return paint("35", s) } // magenta

// Heading prints a bold, accented title line.
func Heading(s string) {
	fmt.Println(Accent(Bold(s)))
}

// Field prints one aligned "label : value" row (label dimmed, fixed width).
func Field(label, value string) {
	fmt.Printf("  %s  %s\n", Dim(fmt.Sprintf("%-10s", label)), value)
}

// OK / Warn / Err print a status line with a leading glyph.
func OK(format string, a ...any)   { fmt.Println(Green("✓") + " " + fmt.Sprintf(format, a...)) }
func Warn(format string, a ...any) { fmt.Println(Yellow("!") + " " + fmt.Sprintf(format, a...)) }
func Info(format string, a ...any) { fmt.Println(Cyan("›") + " " + fmt.Sprintf(format, a...)) }

// Hint prints a dimmed next-step suggestion.
func Hint(format string, a ...any) { fmt.Println("  " + Dim(fmt.Sprintf(format, a...))) }
