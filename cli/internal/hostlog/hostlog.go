// Package hostlog gives the running connector one log file whose location does not depend on which
// init system happened to start it.
//
// Before this there was no logging configuration at all, so where a machine's logs went was decided
// by whichever kardianos template applied: journald under systemd, /var/log/<name>.{log,err} under
// the sysv fallback, somewhere else again under launchd. "Where are the logs" therefore had no
// single answer, and the machine that most needs its logs read — a container with no systemd, which
// falls to the sysv template — is exactly the one whose answer is hardest to guess.
//
// That mattered more than it sounds: the reason a control link cannot connect is written to this
// log. A diagnosis nobody can retrieve is not a diagnosis.
//
// Deliberately small. One file, rotated once at a size cap, next to the config where the state file
// already lives — no daemon, no external rotator, nothing to configure, and it works the same in a
// container as on a laptop. Writes go to stderr as well, so whatever the init system captures still
// captures everything it did before.
package hostlog

import (
	"io"
	"os"
	"path/filepath"
	"sync"
)

// How large the log may grow before it is rotated. One old file is kept, so the worst case on disk
// is twice this.
const maxBytes = 4 << 20

// Path is where the log lives, derived from the config path exactly as the state file is.
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "microteams.log")
}

// Writer is the log file plus stderr, or just stderr if the file cannot be opened.
//
// Failing to open it must never stop the connector: a machine that runs and cannot write a log is
// far better than one that refuses to run because it could not.
type Writer struct {
	mu   sync.Mutex
	file *os.File
	path string
	size int64
}

// Open starts writing to the log for this config. The returned writer is safe for concurrent use.
func Open(cfgPath string) io.Writer {
	if cfgPath == "" {
		return os.Stderr
	}
	path := Path(cfgPath)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return os.Stderr
	}
	size := int64(0)
	if info, err := f.Stat(); err == nil {
		size = info.Size()
	}
	return &Writer{file: f, path: path, size: size}
}

func (w *Writer) Write(p []byte) (int, error) {
	// stderr first and unconditionally: whatever the init system was already capturing keeps being
	// captured, so this file adds a place to look rather than moving the logs somewhere new.
	n, err := os.Stderr.Write(p)

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return n, err
	}
	written, ferr := w.file.Write(p)
	if ferr != nil {
		return n, err
	}
	w.size += int64(written)
	if w.size >= maxBytes {
		w.rotateLocked()
	}
	return n, err
}

// rotateLocked keeps exactly one previous file. Losing older history is the price of having no
// rotation daemon; the alternative — an unbounded file on a machine nobody logs into — eventually
// fills a disk, which is a worse failure than a short history.
func (w *Writer) rotateLocked() {
	_ = w.file.Close()
	_ = os.Rename(w.path, w.path+".1")
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		w.file = nil
		return
	}
	w.file = f
	w.size = 0
}
