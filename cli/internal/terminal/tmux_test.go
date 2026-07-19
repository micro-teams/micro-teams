package terminal

import (
	"strings"
	"testing"
	"time"
)

// TestHasSessionAndAdopt spins up a fully isolated private tmux server on its own
// temp socket (never the live service's), so it cannot touch any running screen.
// It verifies HasSession reflects an existing session and that Adopt wraps it
// without spawning. Skipped when no tmux binary is available.
func TestHasSessionAndAdopt(t *testing.T) {
	if _, err := findTmux(); err != nil {
		t.Skip("no tmux available")
	}
	m, err := NewManager()
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.KillServer()

	if m.HasSession("nope") {
		t.Error("HasSession returned true for a nonexistent session")
	}

	sess, err := m.Spawn("t1", []string{"sh", "-c", "sleep 30"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	if !m.HasSession("t1") {
		t.Error("HasSession returned false for a live session")
	}

	adopted := m.Adopt("t1")
	if adopted == nil || adopted.name != "t1" {
		t.Fatalf("Adopt returned %+v, want a Session named t1", adopted)
	}

	_ = sess.Close()
	if m.HasSession("t1") {
		t.Error("HasSession returned true after the session was closed")
	}
}

// TestScrollHistory proves the 现场 scroll mechanism end-to-end against a real tmux:
// a normal-buffer program's output is retained in tmux scrollback, ScrollUp enters
// copy-mode and pages back into that history, and scrolling to the bottom leaves
// copy-mode so the pane resumes following live output. This is the whole reason the
// viewer drives copy-mode instead of sending PgUp/PgDn to the program.
func TestScrollHistory(t *testing.T) {
	if _, err := findTmux(); err != nil {
		t.Skip("no tmux available")
	}
	m, err := NewManager()
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.KillServer()

	// Print 100 lines to the NORMAL screen buffer (sh uses no alternate screen), then
	// idle — so tmux keeps all 100 in its scrollback even though only ~24 are visible.
	s, err := m.Spawn("scroll1",
		[]string{"sh", "-c", "for i in $(seq 1 100); do echo line$i; done; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	defer s.Close()

	// Wait until the last line has been printed and is on screen.
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(s.capture(), "line100") {
		if time.Now().After(deadline) {
			t.Fatalf("program never finished printing; last screen:\n%s", s.capture())
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Scrolling up must enter copy-mode and move off the live bottom.
	s.ScrollUp(20)
	if !s.copyMode {
		t.Fatal("ScrollUp did not enter copy-mode")
	}
	if s.atBottom() {
		t.Fatal("still at the live bottom after ScrollUp(20)")
	}
	// The scrolled view must reveal earlier history no longer on the live screen.
	if got := s.capture(); !strings.Contains(got, "line80") {
		t.Errorf("scrolled view does not show earlier history (line80); got:\n%s", got)
	}

	// Scrolling far enough back down returns to the live bottom and leaves copy-mode.
	s.ScrollDown(40)
	if s.copyMode {
		t.Error("copy-mode not left after scrolling back to the bottom")
	}
	if !s.atBottom() {
		t.Error("not reported at the live bottom after scrolling down")
	}

	// ExitCopyMode is idempotent when already live.
	s.ExitCopyMode()
	if s.copyMode {
		t.Error("copyMode still set after ExitCopyMode")
	}
}
