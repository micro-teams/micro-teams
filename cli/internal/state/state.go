// Package state shares the resident service's runtime facts with the short CLI commands, through
// one small file beside the config: how many screens are hosted, whether the control link is
// established (and why not), and where the service's MultiPath client listens. The service is the
// only writer and rewrites the whole file whenever one of these changes; a missing or stale file
// reads as nothing running.
//
//   - Path(cfgPath) is the file: state.json beside the config.
//
//   - Write(cfgPath, screens, client, link) records everything at once, with this process's pid.
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
//   - KeepsSessions(cfgPath) reports whether the running service leaves the sessions running when
//     it stops. Every writer of this build does; a running connector that does not say so ends
//     them, and has to be handed over to this build before it is stopped.
//
//     state.Write(cfgPath, 2, state.Client{PID: 42, Listen: "127.0.0.1:7000", Status: "127.0.0.1:7001"}, state.Link{Up: true, Since: time.Now()})
//     if c := state.CurrentClient(cfgPath); c.Listen != "" { ... }
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"time"
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
	// KeepsSessions is what the writer does with the sessions when it stops: true is leave them.
	KeepsSessions bool `json:"keepsSessions,omitempty"`
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
func Write(cfgPath string, screens int, client Client, link Link) {
	snap := snapshot{
		Screens:   screens,
		PID:       os.Getpid(),
		LinkUp:    link.Up,
		LinkError: link.Error,
		Client:    client,

		KeepsSessions: true,
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

// KeepsSessions reports whether the running service leaves the sessions running when it stops.
func KeepsSessions(cfgPath string) bool {
	s, ok := live(cfgPath)
	return ok && s.KeepsSessions
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

// Screens is the recorded screen count.
func Screens(cfgPath string) int {
	s, ok := live(cfgPath)
	if !ok {
		return 0
	}
	return s.Screens
}
