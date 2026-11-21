// Package state shares the resident service's runtime facts with the short CLI commands, through
// one small file beside the config: how many screens are hosted, which tmux hosts them, whether the
// control link is established (and why not), and where the service's MultiPath client listens. The service is the
// only writer and rewrites the whole file whenever one of these changes; a missing or stale file
// reads as nothing running.
//
//   - Path(cfgPath) is the file: state.json beside the config.
//
//   - Write(cfgPath, screens, client, link, tmux) records everything at once, with this process's pid.
//     Clear(cfgPath) removes the file when the service stops.
//
//   - PID(cfgPath) is the service's pid if it is alive, else 0; RawPID(cfgPath) is the recorded pid
//     without that check (uninstall needs it to make sure the process is gone).
//
//   - Screens(cfgPath) is the recorded screen count, 0 when the writer is gone.
//
//   - CurrentLink(cfgPath) is the control link (Link: up, since when, the last error), down when
//     the writer is gone.
//
//   - CurrentClient(cfgPath) is the service's MultiPath client (Client: pid, stream and status
//     addresses), empty when the writer is gone.
//
//   - Tmux is the tmux the service hosts its screens on, given as what terminal.NewManager resolves
//     it from: the binary, and the two variables that place its socket ($XDG_RUNTIME_DIR, the temp
//     dir). TmuxOf(bin) is that of this process with the binary it found; CurrentTmux(cfgPath) the
//     running service's, zero when the writer is gone; (Tmux).Apply() sets this process's
//     environment to it, so that terminal.NewManager here finds the service's binary and socket
//     whatever this process's own environment says.
//
//     state.Write(cfgPath, 2, state.Client{PID: 42, Listen: "127.0.0.1:7000", Status: "127.0.0.1:7001"}, state.Link{Up: true, Since: time.Now()}, state.TmuxOf(tm.Bin()))
//     if t := state.CurrentTmux(cfgPath); t.Bin != "" { err = t.Apply() }
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/micro-teams/micro-connector/cli/brand"
)

type snapshot struct {
	Screens int `json:"screens"`
	PID     int `json:"pid"`
	// The control link as the service sees it: only the service knows whether it reached the
	// server, which is a different question from whether its process runs. Down with no error is a
	// service that has not connected yet, not a failure.
	LinkUp    bool   `json:"linkUp,omitempty"`
	LinkSince int64  `json:"linkSince,omitempty"`
	LinkError string `json:"linkError,omitempty"`
	Client    Client `json:"multipathClient,omitzero"`
	Tmux      Tmux   `json:"tmux,omitzero"`
}

// Tmux is what decides which tmux binary and socket terminal.NewManager uses.
type Tmux struct {
	Bin           string `json:"bin"`
	XDGRuntimeDir string `json:"xdgRuntimeDir,omitempty"`
	TempDir       string `json:"tempDir"`
}

// TmuxOf is the tmux bin with this process's socket-placing environment.
func TmuxOf(bin string) Tmux {
	return Tmux{Bin: bin, XDGRuntimeDir: os.Getenv("XDG_RUNTIME_DIR"), TempDir: os.TempDir()}
}

// Apply makes this process resolve t: the brand's TMUX variable names the binary, and
// XDG_RUNTIME_DIR and TMPDIR are the service's (XDG_RUNTIME_DIR unset when it had none).
func (t Tmux) Apply() error {
	if err := os.Setenv(brand.Current.Env("TMUX"), t.Bin); err != nil {
		return err
	}
	if err := os.Setenv("TMPDIR", t.TempDir); err != nil {
		return err
	}
	if t.XDGRuntimeDir == "" {
		return os.Unsetenv("XDG_RUNTIME_DIR")
	}
	return os.Setenv("XDG_RUNTIME_DIR", t.XDGRuntimeDir)
}

// Client is the service's MultiPath client: its pid, the address programs connect to, and the
// address of its /status.
type Client struct {
	PID    int    `json:"pid,omitempty"`
	Listen string `json:"listen,omitempty"`
	Status string `json:"status,omitempty"`
}

// Link is what the service knows about the control connection.
type Link struct {
	Up    bool
	Since time.Time // when the current connection came up; zero while it is down
	Error string    // why the last attempt failed; empty after a success
}

// Path is the state file, beside the config.
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "state.json")
}

// Write records the screen count, the client and the control link in one write, so that no reader
// ever sees one field updated and another stale.
func Write(cfgPath string, screens int, client Client, link Link, tmux Tmux) {
	snap := snapshot{
		Screens:   screens,
		PID:       os.Getpid(),
		LinkUp:    link.Up,
		LinkError: link.Error,
		Client:    client,
		Tmux:      tmux,
	}
	if !link.Since.IsZero() {
		snap.LinkSince = link.Since.Unix()
	}
	data, err := json.Marshal(snap)
	if err != nil {
		return
	}
	_ = os.WriteFile(Path(cfgPath), data, 0o600)
}

// Clear removes the state file.
func Clear(cfgPath string) { _ = os.Remove(Path(cfgPath)) }

func read(cfgPath string) (snapshot, bool) {
	var s snapshot
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil || json.Unmarshal(data, &s) != nil {
		return snapshot{}, false
	}
	return s, true
}

func alive(pid int) bool {
	p, err := os.FindProcess(pid)
	return err == nil && p.Signal(syscall.Signal(0)) == nil
}

// live reads the snapshot and reports whether its writer is still running.
func live(cfgPath string) (snapshot, bool) {
	s, ok := read(cfgPath)
	return s, ok && (s.PID <= 0 || alive(s.PID))
}

// PID is the running service's pid, or 0.
func PID(cfgPath string) int {
	s, ok := read(cfgPath)
	if !ok || s.PID <= 0 || !alive(s.PID) {
		return 0
	}
	return s.PID
}

// RawPID is the recorded pid without a liveness check (0 if none).
func RawPID(cfgPath string) int {
	s, _ := read(cfgPath)
	return s.PID
}

// CurrentLink is what the running service knows about the control connection.
func CurrentLink(cfgPath string) Link {
	s, ok := live(cfgPath)
	if !ok {
		return Link{}
	}
	link := Link{Up: s.LinkUp, Error: s.LinkError}
	if s.LinkSince > 0 {
		link.Since = time.Unix(s.LinkSince, 0)
	}
	return link
}

// CurrentClient is the running service's MultiPath client.
func CurrentClient(cfgPath string) Client {
	s, ok := live(cfgPath)
	if !ok {
		return Client{}
	}
	return s.Client
}

// CurrentTmux is the tmux the running service hosts its screens on.
func CurrentTmux(cfgPath string) Tmux {
	s, ok := live(cfgPath)
	if !ok || s.PID <= 0 {
		return Tmux{}
	}
	return s.Tmux
}

// Screens is the recorded screen count.
func Screens(cfgPath string) int {
	s, ok := live(cfgPath)
	if !ok {
		return 0
	}
	return s.Screens
}
