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
)

type snapshot struct {
	Screens int `json:"screens"`
	PID     int `json:"pid"`
}

// Path derives the state file location from the config path (same directory).
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "state.json")
}

// Write records the current number of hosted screens.
func Write(cfgPath string, screens int) {
	data, err := json.Marshal(snapshot{Screens: screens, PID: os.Getpid()})
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
