package acpscreen

// What acp-screen paints. The format is for two readers at once: a person watching the agent's
// screen, and the screen applet, which only needs the last line. So the transcript is plain lines
// in the terminal's own scrollback (no full-screen UI, nothing to redraw), and the very last line is
// always the status line, repainted in place:
//
//	── ● working 1m12s · deepseek-v4 ──   while a prompt is in flight
//	── ○ ready · deepseek-v4 ──           waiting for the next message
//	── ✕ exited (status 1) ──             the agent process is gone
//
// The applet's whole job is to match `● working` / `○ ready` / `✕ exited` on that line.

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	dim   = "\x1b[2m"
	bold  = "\x1b[1m"
	red   = "\x1b[31m"
	green = "\x1b[32m"
	reset = "\x1b[0m"
	clear = "\r\x1b[K"
)

type screen struct {
	mu      sync.Mutex
	w       io.Writer
	width   int
	state   string // "starting", "working", "ready", "exited"
	since   time.Time
	model   string
	queued  int
	exitMsg string
	input   []rune // what a person is typing in the pane, not yet sent
}

func newScreen(w io.Writer, width int) *screen {
	if width < 40 {
		width = 100
	}
	return &screen{w: w, width: width, state: "starting", since: time.Now()}
}

// line prints one transcript line above the status line. In raw mode the terminal does no
// newline translation, so every line ends in \r\n.
func (s *screen) line(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, l := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		fmt.Fprint(s.w, clear+strings.TrimRight(l, "\r")+"\r\n")
	}
	s.paintLocked()
}

func (s *screen) set(state string) {
	s.mu.Lock()
	if s.state != state {
		s.state = state
		s.since = time.Now()
	}
	s.paintLocked()
	s.mu.Unlock()
}

func (s *screen) setModel(m string) {
	s.mu.Lock()
	s.model = m
	s.paintLocked()
	s.mu.Unlock()
}

func (s *screen) setQueued(n int) {
	s.mu.Lock()
	s.queued = n
	s.paintLocked()
	s.mu.Unlock()
}

func (s *screen) setInput(r []rune) {
	s.mu.Lock()
	s.input = append(s.input[:0], r...)
	s.paintLocked()
	s.mu.Unlock()
}

func (s *screen) exited(msg string) {
	s.mu.Lock()
	s.state, s.exitMsg = "exited", msg
	s.paintLocked()
	fmt.Fprint(s.w, "\r\n")
	s.mu.Unlock()
}

// tick repaints the status line so the elapsed time moves while working.
func (s *screen) tick() {
	s.mu.Lock()
	if s.state == "working" {
		s.paintLocked()
	}
	s.mu.Unlock()
}

func (s *screen) paintLocked() {
	var b strings.Builder
	b.WriteString("── ")
	switch s.state {
	case "working":
		b.WriteString(bold + "● working" + reset + " " + elapsed(time.Since(s.since)))
	case "ready":
		b.WriteString(green + "○ ready" + reset)
	case "exited":
		b.WriteString(red + "✕ exited" + reset)
		if s.exitMsg != "" {
			b.WriteString(" (" + s.exitMsg + ")")
		}
	default:
		b.WriteString("… starting")
	}
	if s.model != "" {
		b.WriteString(" · " + s.model)
	}
	if s.queued > 0 {
		fmt.Fprintf(&b, " · %d queued", s.queued)
	}
	b.WriteString(" ──")
	if len(s.input) > 0 {
		b.WriteString(" › " + clipRunes(string(s.input), s.width/2))
	}
	fmt.Fprint(s.w, clear+b.String())
}

func elapsed(d time.Duration) string {
	d = d.Round(time.Second)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
}

// clipRunes keeps the first max runes of a one-line rendering of s.
func clipRunes(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}

// firstLines keeps at most n lines of s, saying how many were dropped.
func firstLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) <= n {
		return strings.Join(lines, "\n")
	}
	return strings.Join(lines[:n], "\n") + fmt.Sprintf("\n… (%d more lines)", len(lines)-n)
}

func indent(s, prefix string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = prefix + l
	}
	return strings.Join(lines, "\n")
}
