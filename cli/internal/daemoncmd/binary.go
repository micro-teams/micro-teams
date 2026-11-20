package daemoncmd

// `update` and `uninstall`: the binary itself.
//
// Update with a running service only signals it (SIGUSR2): the update happens inside that process,
// which replaces the binaries and hands off to the new one with syscall.Exec, so nothing it hosts
// notices. With no service running there is nothing to keep, and the files are replaced directly.
//
// Uninstall is the one command that ends the sessions on this machine, and it says so before it
// does: it removes the service, makes sure the connector process is gone, ends the tmux server, and
// deletes the config and the binary.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/brand"
	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/micro-connector/cli/update"
	"github.com/micro-teams/microteams/cli/internal/mpclient"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/ui"
)

func updateCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "update",
		Short: "Update the microteams binary to the latest published build (sessions keep running)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if pid := state.PID(*cfgPath); pid > 0 {
				if err := syscall.Kill(pid, syscall.SIGUSR2); err != nil {
					return fmt.Errorf("signal running service (pid %d): %w", pid, err)
				}
				ui.OK("Update signalled to the running service (pid %d).", pid)
				ui.Hint("it downloads, verifies and hands off in place — running sessions are preserved")
				return nil
			}
			cfg, err := config.Load(*cfgPath)
			if err != nil || cfg.Base == "" {
				return fmt.Errorf("no server configured — run `microteams login` first")
			}
			fmt.Println("Downloading the latest microteams and multipath client…")
			tmp, err := update.Fetch(context.Background(), cfg.Base, brand.Current.Name)
			if err != nil {
				return err
			}
			self, err := update.SelfPath()
			if err != nil {
				return err
			}
			if err := update.Replace(tmp, self); err != nil {
				return err
			}
			if err := mpclient.Install(context.Background(), cfg.Base, mpclient.BinaryPath(filepath.Dir(*cfgPath))); err != nil {
				return err
			}
			ui.OK("microteams updated.")
			ui.Hint("no service was running; the new binary is in place and used from now on")
			return nil
		},
	})
}

func uninstallCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "uninstall",
		Short: "Remove microteams from this machine, ending its sessions (service, config, binary)",
		RunE: func(_ *cobra.Command, _ []string) error {
			n, countErr := liveSessions()
			switch {
			case countErr != nil:
				ui.Warn("Every session on this machine will be ended (cannot count them: %v).", countErr)
			case n > 0:
				ui.Warn("The %d running session(s) on this machine will be ended.", n)
			}
			// The pid first: whatever the service manager does, the process must be gone before its
			// config and binary are, or it keeps running on stale credentials, unmanageable.
			pid := state.RawPID(*cfgPath)
			if _, found := service.Installed(*cfgPath); found {
				_ = service.ControlInstalled(*cfgPath, "stop")
				_ = service.ControlInstalled(*cfgPath, "uninstall")
			}
			// Stopping a system unit needs root, but the process runs as this user, so it can be
			// stopped directly; if even that fails, nothing is removed.
			if err := stopProcess(pid); err != nil {
				return fmt.Errorf(
					"the microteams connector is still running (pid %d) and could not be stopped; "+
						"nothing was removed — re-run as: sudo microteams uninstall", pid)
			}
			if tm, err := terminal.NewManager(); err != nil {
				return fmt.Errorf("cannot reach the sessions' tmux to end them: %w; nothing was removed", err)
			} else if err := tm.KillServer(); err != nil {
				return fmt.Errorf("end the sessions: %w; nothing was removed", err)
			}
			dir := filepath.Dir(*cfgPath)
			if err := os.RemoveAll(dir); err != nil {
				return fmt.Errorf("remove config %s: %w", dir, err)
			}
			exe, err := os.Executable()
			if err != nil {
				return err
			}
			if err := os.Remove(exe); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove binary %s: %w (delete it manually)", exe, err)
			}
			fmt.Println("microteams uninstalled — sessions ended; service, config, and binary removed.")
			return nil
		},
	})
}

// procAlive reports whether pid names a live process; EPERM means it exists but is not ours.
func procAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// stopProcess makes sure pid is no longer running: SIGTERM, then SIGKILL, polling between. It fails
// when the process is still alive after both, e.g. one this user may not signal.
func stopProcess(pid int) error {
	if !procAlive(pid) {
		return nil
	}
	_ = syscall.Kill(pid, syscall.SIGTERM)
	for range 30 {
		if !procAlive(pid) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
	for range 20 {
		if !procAlive(pid) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("process %d still alive", pid)
}
