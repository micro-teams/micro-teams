package terminal

import (
	"os"
	"strings"
	"testing"
	"time"
)

// isolated builds a Manager whose tmux server is this test's alone.
//
// NewManager deliberately derives its socket from a STABLE per-user path, so that a restarted or
// self-updated connector can find the sessions it left behind. A test that calls it bare therefore
// gets the socket of whatever connector is running as this user — and these tests kill their server
// when they are done. So `go test ./...` on a machine that hosts agents takes down every screen on
// it. That is not hypothetical: it happened twice on 2026-07-31 and was investigated for hours as a
// spontaneous tmux death, OOM included, before the test suite turned out to be the killer.
//
// Overriding TMPDIR moves the whole runtime dir somewhere only this test knows about — which is what
// the comments below always claimed and never did.
func isolated(t *testing.T) *Manager {
	t.Helper()
	t.Setenv("TMPDIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m
}

// TestHasSessionAndAdopt spins up a fully isolated private tmux server on its own
// temp socket (never the live service's), so it cannot touch any running screen.
// It verifies HasSession reflects an existing session and that Adopt wraps it
// without spawning. Skipped when no tmux binary is available.
func TestHasSessionAndAdopt(t *testing.T) {
	if _, err := findTmux(); err != nil {
		t.Skip("no tmux available")
	}
	m := isolated(t)
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

// TestScrollHistory proves the live-screen scroll mechanism end-to-end against a real tmux:
// a normal-buffer program's output is retained in tmux scrollback, ScrollUp enters
// copy-mode and pages back into that history, and scrolling to the bottom leaves
// copy-mode so the pane resumes following live output. This is the whole reason the
// viewer drives copy-mode instead of sending PgUp/PgDn to the program.
func TestScrollHistory(t *testing.T) {
	if _, err := findTmux(); err != nil {
		t.Skip("no tmux available")
	}
	m := isolated(t)
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
	for !strings.Contains(screen(t, s), "line100") {
		if time.Now().After(deadline) {
			t.Fatalf("program never finished printing; last screen:\n%s", screen(t, s))
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
	if got := screen(t, s); !strings.Contains(got, "line80") {
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

// screen is capture() for tests, which have no use for the error: a failed capture
// shows up as an empty screen and the assertion that was waiting for content fails
// on its own deadline.
func screen(t *testing.T, s *Session) string {
	t.Helper()
	out, err := s.capture()
	if err != nil {
		return ""
	}
	return out
}

// TestWriteLongMessage is T-058: a long message a human sends is never delivered to the agent.
//
// It reaches the database and the sender's own screen, so it looks sent; what fails is the last
// hop. The applet hands the whole message to `tmux send-keys -l -- <text>` in one go, and tmux
// caps how long a single command may be:
//
//	script: term.write: terminal: write "s9dcde052": exit status 1: command too long
//
// Nothing upstream is told — the error goes to the connector's log, which nobody reads — so the
// agent simply never hears what was said to it. That silence is the bug; the length limit is only
// how it starts.
//
// The test therefore asserts both halves: the write must not fail, and the bytes must actually
// arrive at the program. The program runs with `stty raw` because the tty line discipline has a
// length limit of its own (~4KB per line in canonical mode) that would otherwise be mistaken for
// this one.
func TestWriteLongMessage(t *testing.T) {
	if _, err := findTmux(); err != nil {
		t.Skip("no tmux available")
	}
	m := isolated(t)
	defer m.KillServer()

	out := t.TempDir() + "/heard.txt"
	s, err := m.Spawn("long1", []string{"sh", "-c", "stty raw -echo; cat > " + out + "; sleep 30"},
		nil, 80, 24)
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	defer s.Close()
	time.Sleep(500 * time.Millisecond) // let `stty raw` take effect before typing

	// Comfortably past tmux's limit and a realistic size for a long human message.
	body := strings.Repeat("The quick brown fox jumps over the lazy dog. ", 500) // ~22KB
	if err := s.Write([]byte(body)); err != nil {
		t.Fatalf("Write of a %d-byte message failed: %v", len(body), err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for {
		got, err := os.ReadFile(out)
		if err == nil && len(got) >= len(body) {
			if string(got[:len(body)]) != body {
				t.Fatalf("the program received %d bytes but they are not what was sent", len(got))
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the program received %d of %d bytes", len(got), len(body))
		}
		time.Sleep(100 * time.Millisecond)
	}
}
