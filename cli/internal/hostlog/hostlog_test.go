// The log has one job: be there, in a place that does not depend on which init system started the
// connector, without needing a rotation daemon on a machine nobody logs into.
//
// Note what is NOT tested here: the connector actually writing to it end to end. Doing that means
// starting a Host, and a Host takes the per-user tmux manager whose teardown kills the live tmux
// server — on this machine that is every agent's screen, which this project has already done to
// itself once. So the wiring is checked by reading the code and the behaviour is checked here.
package hostlog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWritesToAFileBesideTheConfig(t *testing.T) {
	cfg := filepath.Join(t.TempDir(), "config.json")
	w := Open(cfg)

	if _, err := w.Write([]byte("hello\n")); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(Path(cfg))
	if err != nil {
		t.Fatalf("the log should be at %s: %v", Path(cfg), err)
	}
	if !strings.Contains(string(data), "hello") {
		t.Fatalf("got %q", data)
	}
}

// It must not grow without bound: nobody is watching this machine's disk.
func TestItRotatesAtTheCapAndKeepsOnePreviousFile(t *testing.T) {
	cfg := filepath.Join(t.TempDir(), "config.json")
	w := Open(cfg)

	chunk := make([]byte, 64*1024)
	for i := range chunk {
		chunk[i] = 'x'
	}
	for written := 0; written < maxBytes+len(chunk); written += len(chunk) {
		if _, err := w.Write(chunk); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := os.Stat(Path(cfg) + ".1"); err != nil {
		t.Fatal("the previous log should have been kept")
	}
	info, err := os.Stat(Path(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() >= maxBytes {
		t.Fatalf("the current log should have started over, size = %d", info.Size())
	}
}

// A machine that cannot write its log must still run. Refusing to start because of a log file would
// be a worse failure than the one it is trying to help diagnose.
func TestAnUnwritableLocationDoesNotStopAnything(t *testing.T) {
	dir := t.TempDir()
	// A directory where the log path itself is a directory: opening it as a file must fail.
	cfg := filepath.Join(dir, "config.json")
	if err := os.Mkdir(Path(cfg), 0o700); err != nil {
		t.Fatal(err)
	}

	w := Open(cfg)
	if _, err := w.Write([]byte("still running\n")); err != nil {
		t.Fatalf("writing must not fail just because the file could not be opened: %v", err)
	}
}

func TestNoConfigPathIsHarmless(t *testing.T) {
	if _, err := Open("").Write([]byte("x\n")); err != nil {
		t.Fatal(err)
	}
}
