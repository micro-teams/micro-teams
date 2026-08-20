// Package state shares one small runtime fact between the long-running host and
// the ad-hoc CLI commands: how many screens are currently hosted. The host
// rewrites the file as screens come and go; commands like `microteams link
// disconnect` read it to warn before killing live work. Best-effort by design —
// a missing or stale file just reads as zero.
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
	// Which network path the control link is using. Written by the host, read by `status`, and
	// meaningless to anything else — a machine with one line always reports that one.
	LineID  string `json:"lineId,omitempty"`
	LineURL string `json:"lineUrl,omitempty"`
	// Whether the control link is actually established right now, since when, and why the last
	// attempt failed if it did.
	//
	// This exists because everything else that claimed to know was answering a different question.
	// `link connect` printed "Connected." when the SERVICE MANAGER had started the process, and
	// `status` said connected whenever that process was running — neither of which means the machine
	// reached the control plane. A machine whose every dial failed reported success from both, and
	// the live screen simply did not open. The host is the only thing that knows, so it says so
	// here.
	//
	// LinkUp false with no LinkError is not a failure: a process that started half a second ago has
	// not connected YET. Telling those apart is the whole point — one asks you to wait, the other
	// hands you a reason.
	LinkUp    bool   `json:"linkUp,omitempty"`
	LinkSince int64  `json:"linkSince,omitempty"`
	LinkError string `json:"linkError,omitempty"`

	// Whether the running host understands the signal that asks it to re-measure and re-dial.
	//
	// A capability rather than a version, because the question is never "which build is this" but
	// "will it survive being asked". The binary on disk updates without the service restarting, so
	// a new command can easily meet an old process — and SIGHUP to a process that does not handle
	// it terminates it, taking the machine offline. The flag is how the command knows not to.
	Relink bool `json:"relink,omitempty"`
}

// Path derives the state file location from the config path (same directory).
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "state.json")
}

// Line names a network path the control link is using.
type Line struct {
	ID  string
	URL string
}

// Link is what the host knows about the control connection, as opposed to what the service manager
// knows about the process.
type Link struct {
	Up bool
	// Since is when the current connection came up. Zero while it is down.
	Since time.Time
	// Error is why the last attempt failed, empty if the last thing that happened was a success.
	Error string
}

// Write records the current number of hosted screens and the line carrying the control link.
//
// Both together, in one write, because the host is the only writer and knows both. Two writers each
// owning a field would race on the file and each would occasionally erase the other's.
func Write(cfgPath string, screens int, line Line, link Link) {
	snap := snapshot{
		Screens:   screens,
		PID:       os.Getpid(),
		LineID:    line.ID,
		LineURL:   line.URL,
		LinkUp:    link.Up,
		LinkError: link.Error,
		Relink:    true,
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

// Clear removes the state file (host shutdown).
func Clear(cfgPath string) { _ = os.Remove(Path(cfgPath)) }

// PID returns the process id of the running host (the `microteams run` service), or 0
// if none is recorded or the recorded process is no longer alive. Used by `microteams
// update` to signal the live service so the update happens in-process (preserving
// its private tmux).
func PID(cfgPath string) int {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return 0
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil || s.PID <= 0 {
		return 0
	}
	if p, err := os.FindProcess(s.PID); err != nil || p.Signal(syscall.Signal(0)) != nil {
		return 0
	}
	return s.PID
}

// RawPID returns the recorded host pid without a liveness check (0 if none). Unlike
// PID it does not treat an unsignalable (EPERM) process as absent — `microteams uninstall`
// needs the real pid to guarantee the process is stopped before deleting its files.
func RawPID(cfgPath string) int {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return 0
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil {
		return 0
	}
	return s.PID
}

// Screens reports the recorded screen count, verifying the writer is still
// alive so a crashed host doesn't leave a scary stale warning behind.
// CanRelink reports whether the running host handles the re-measure-and-re-dial signal. False for
// an older host, which must be restarted instead — signalling it would kill it.
func CanRelink(cfgPath string) bool {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return false
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil {
		return false
	}
	return s.Relink
}

// CurrentLine reports the path the running host's control link is using, or an empty Line when
// nothing is recorded — an older host, or none running.
func CurrentLine(cfgPath string) Line {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return Line{}
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil {
		return Line{}
	}
	return Line{ID: s.LineID, URL: s.LineURL}
}

// CurrentLink reports what the running host knows about the control connection.
//
// A host that is not running, or one too old to record this, reads as down with no error — which is
// the honest answer in both cases: nothing here is claiming a connection exists.
func CurrentLink(cfgPath string) Link {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return Link{}
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil {
		return Link{}
	}
	link := Link{Up: s.LinkUp, Error: s.LinkError}
	if s.LinkSince > 0 {
		link.Since = time.Unix(s.LinkSince, 0)
	}
	// A recorded connection whose writer is gone is not a connection.
	if s.PID > 0 {
		if p, err := os.FindProcess(s.PID); err != nil || p.Signal(syscall.Signal(0)) != nil {
			return Link{}
		}
	}
	return link
}

func Screens(cfgPath string) int {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return 0
	}
	var s snapshot
	if json.Unmarshal(data, &s) != nil {
		return 0
	}
	if s.PID > 0 {
		if p, err := os.FindProcess(s.PID); err != nil || p.Signal(syscall.Signal(0)) != nil {
			return 0
		}
	}
	return s.Screens
}
