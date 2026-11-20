package daemoncmd

// `start`, `stop`, `restart`, `enable` and `disable`: the connector as a service of this machine.
//
// A system service is the default (it runs with nobody logged in, as the user who installed it), so
// installing one, and acting on one that is installed, re-runs the command under sudo; the hidden
// --user installs a per-user service instead. Acting on an installed service always uses the variant
// that is installed, whoever asks.
//
// The service manager installs a service and makes it start at boot in one step, so `start` on a
// machine with no service installs one, and `disable` stops the connector as it removes it from
// boot. None of this ends a session: the tmux server outlives the connector, and the next start
// re-adopts every session. Two things could still end them on a stop, and both are dealt with
// before anything is stopped. A running connector that does not record keepsSessions in the state
// file ends every session when it exits; handOff makes it update itself in place first, which it
// does without ending them. A systemd unit without KillMode=process kills the whole service,
// tmux included; keepSessions rewrites it when this process may, and otherwise asks once.
//
// On WSL a service needs systemd, which WSL runs only when /etc/wsl.conf says so; installing turns
// it on and says that WSL must restart before the connector can run.

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/microteams/cli/internal/host"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/ui"
)

func startCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var userService bool
	c := withConfig(&cobra.Command{
		Use:   "start [server-url]",
		Short: "Connect this machine now (installs the background service if needed)",
		Long: "Starts the connector as a background service, logging in first if this machine\n" +
			"is not logged in yet. Without a service installed, one is installed, which also\n" +
			"makes it start at boot (`microteams disable` turns that off).\n\n" +
			"Installs a system-wide service by default (it runs even with no user logged in),\n" +
			"elevating with sudo when needed.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return startService(*cfgPath, firstArg(args), userService)
		},
	})
	userFlag(c, &userService)
	return c
}

func enableCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var userService bool
	c := withConfig(&cobra.Command{
		Use:   "enable [server-url]",
		Short: "Start the connector at boot (or login), and now",
		Long: "Installs the background service so the connector starts at boot, and starts it\n" +
			"now, logging in first if needed. `microteams disable` undoes it.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return startService(*cfgPath, firstArg(args), userService)
		},
	})
	userFlag(c, &userService)
	return c
}

func stopCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var yes bool
	c := withConfig(&cobra.Command{
		Use:   "stop",
		Short: "Disconnect this machine (sessions keep running)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if !installedOrSay(*cfgPath) {
				return nil
			}
			if err := stopService(*cfgPath, yes, "stop"); err != nil {
				return err
			}
			ui.OK("Stopped. Sessions on this machine keep running.")
			ui.Hint("`microteams start` connects again · it still starts at boot unless `microteams disable`")
			return nil
		},
	})
	yesFlag(c, &yes)
	return c
}

func restartCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var yes bool
	c := withConfig(&cobra.Command{
		Use:   "restart",
		Short: "Restart the connector (sessions keep running)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if !installedOrSay(*cfgPath) {
				return nil
			}
			if err := stopService(*cfgPath, yes, "restart"); err != nil {
				return err
			}
			reportLink(*cfgPath, "Restarted")
			return nil
		},
	})
	yesFlag(c, &yes)
	return c
}

func disableCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var yes bool
	c := withConfig(&cobra.Command{
		Use:   "disable",
		Short: "Stop the connector and stop starting it at boot (sessions keep running)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if !installedOrSay(*cfgPath) {
				return nil
			}
			if err := stopService(*cfgPath, yes, "stop", "uninstall"); err != nil {
				return err
			}
			ui.OK("Stopped, and no longer started at boot. Sessions on this machine keep running.")
			ui.Hint("`microteams enable` to undo")
			return nil
		},
	})
	yesFlag(c, &yes)
	return c
}

func userFlag(c *cobra.Command, v *bool) {
	c.Flags().BoolVar(v, "user", false, "install a user-level service instead of system-wide")
	_ = c.Flags().MarkHidden("user")
}

// yesFlag adds --yes, and --force, its spelling in the forms these commands replace.
func yesFlag(c *cobra.Command, v *bool) {
	c.Flags().BoolVarP(v, "yes", "y", false, "do not ask, even if sessions would end")
	c.Flags().BoolVar(v, "force", false, "the same as --yes")
	_ = c.Flags().MarkHidden("force")
}

// startService logs in if needed, installs the service if there is none, and starts it.
func startService(cfgPath, serverArg string, userService bool) error {
	installedUser, installed := service.Installed(cfgPath)
	if installed {
		userService = installedUser
	}
	if err := elevate(userService, cfgPath); err != nil {
		return err
	}
	if installed {
		if err := servesThisConfig(cfgPath, userService); err != nil {
			return err
		}
	}
	cfg, err := loadConfig(cfgPath)
	if err != nil {
		return err
	}
	if cfg.Token == "" || serverArg != "" && cfg.Base != serverArg {
		fmt.Println("Not logged in yet — starting login first.")
		if _, err := doLogin(cfgPath, serverArg); err != nil {
			return err
		}
		ui.OK("Logged in.")
	}
	if installed {
		if _, err := keepSessions(cfgPath, true); err != nil {
			return err
		}
	} else {
		if err := ensureSystemd(); err != nil {
			return err
		}
		if err := service.Control(cfgPath, "install"); err != nil {
			return err
		}
	}
	if err := service.ControlInstalled(cfgPath, "start"); err != nil {
		return err
	}
	reportLink(cfgPath, "Started")
	return nil
}

// stopService runs actions on the installed service once nothing they do would end a session, or
// the person agreed that it may.
func stopService(cfgPath string, yes bool, actions ...string) error {
	userService, _ := service.Installed(cfgPath)
	if err := elevate(userService, cfgPath); err != nil {
		return err
	}
	if err := servesThisConfig(cfgPath, userService); err != nil {
		return err
	}
	if err := handOff(cfgPath); err != nil {
		return err
	}
	ok, err := keepSessions(cfgPath, yes)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("aborted; nothing was changed (--yes skips this question)")
	}
	for _, action := range actions {
		if err := service.ControlInstalled(cfgPath, action); err != nil {
			return err
		}
	}
	return nil
}

// How long a running connector gets to hand itself over to this build: it downloads the binaries
// from the server first.
const handOffWait = 2 * time.Minute

// handOff makes a running connector that ends every session when it exits update itself in place
// (as `microteams update` does: download, replace, re-exec, sessions untouched), and waits until the
// process recording the state is one that keeps them. A connector that already keeps them, or none
// running, needs nothing.
func handOff(cfgPath string) error {
	pid := state.PID(cfgPath)
	if pid == 0 || state.KeepsSessions(cfgPath) {
		return nil
	}
	ui.Info("The running connector (pid %d) ends every session when it exits; asking it to update itself first…", pid)
	if err := syscall.Kill(pid, syscall.SIGUSR2); err != nil {
		return fmt.Errorf("signal the running connector (pid %d): %w; nothing was stopped", pid, err)
	}
	for deadline := time.Now().Add(handOffWait); time.Now().Before(deadline); time.Sleep(time.Second) {
		if state.KeepsSessions(cfgPath) {
			ui.OK("The running connector updated itself in place; its sessions keep running.")
			return nil
		}
	}
	return fmt.Errorf("the running connector (pid %d) did not update itself within %s, so nothing was stopped; `microteams logs` says why", pid, handOffWait)
}

// keepSessions makes sure stopping the installed service leaves the sessions running: it rewrites a
// unit that would kill them, when this process may. When it may not and sessions are running, it
// asks — once — whether to go ahead anyway. It reports whether to proceed.
func keepSessions(cfgPath string, yes bool) (bool, error) {
	rewritten, advice, err := host.EnsureUnit(cfgPath)
	if err != nil {
		return false, err
	}
	if rewritten {
		ui.OK("Rewrote the service unit so sessions survive a stop or restart.")
	}
	if advice == "" {
		return true, nil
	}
	ui.Warn("%s", advice)
	n, err := liveSessions()
	if !mustAsk(n, err, yes) {
		return true, nil
	}
	if err != nil {
		fmt.Printf("Cannot tell whether sessions are running (%v); stopping this service would end them.\n", err)
	} else {
		fmt.Printf("%d session(s) are running; stopping this service ends them.\n", n)
	}
	return confirm("Go ahead anyway?"), nil
}

// servesThisConfig refuses to act on an installed service that runs another config: the service's
// name is the brand's, so acting on it with a different --config would act on someone else's
// connector.
func servesThisConfig(cfgPath string, userService bool) error {
	ok, err := host.UnitServes(cfgPath, userService)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the installed microteams service runs with another config than %s; nothing was changed", cfgPath)
	}
	return nil
}

// mustAsk decides whether a stop that would end every session needs a person's yes: only when
// there may be a session to end and nobody said yes already.
func mustAsk(sessions int, countErr error, yes bool) bool {
	return !yes && (countErr != nil || sessions > 0)
}

// installedOrSay reports whether a service is installed, and says what to do when it is not.
func installedOrSay(cfgPath string) bool {
	if _, found := service.Installed(cfgPath); found {
		return true
	}
	if pid := state.PID(cfgPath); pid > 0 {
		fmt.Printf("No connector service is installed; a connector runs in the foreground as pid %d — stop it where it runs.\n", pid)
		return false
	}
	fmt.Println("No connector service is installed. `microteams start` installs and starts one.")
	return false
}

// ensureSystemd turns systemd on for WSL, where a service cannot run without it.
func ensureSystemd() error {
	switch st, err := service.EnsureSystemd(); {
	case err != nil:
		return fmt.Errorf("WSL runs without systemd, and turning it on failed: %w", err)
	case st == service.SystemdNeedsRestart:
		return errors.New("systemd is now turned on in /etc/wsl.conf, which WSL reads when it starts: " +
			"run `wsl --shutdown` in Windows, open this distribution again, and run `microteams start`")
	}
	return nil
}

// How long a start waits for the host to establish the control link before reporting what it
// sees. The answer at the end is honest either way, so being wrong here costs a re-run of `status`.
const connectWait = 8 * time.Second

// reportLink waits for the started connector to reach the server and says how that went.
func reportLink(cfgPath, done string) {
	deadline := time.Now().Add(connectWait)
	var link state.Link
	for time.Now().Before(deadline) {
		if link = state.CurrentLink(cfgPath); link.Up || link.Error != "" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	switch {
	case link.Up:
		ui.OK("%s and connected. The server can now open sessions on this machine.", done)
		ui.Hint("`microteams status` to check · `microteams stop` to disconnect")
	case link.Error != "":
		ui.Warn("%s, but not connected: %s", done, link.Error)
		ui.Hint("`microteams status` to check again · `microteams logs` for the full story")
	default:
		ui.Warn("%s, but not connected yet.", done)
		ui.Hint("`microteams status` to check again · `microteams logs` for the full story")
	}
}

// elevate re-runs this exact command under sudo when it acts on a system service and this process
// is not root; the elevated child does the work and this process exits with its status. Without
// sudo it carries on as this user, which installs a user service and fails to act on a system one.
func elevate(userService bool, cfgPath string) error {
	if userService || os.Geteuid() == 0 {
		return nil
	}
	sudo, err := exec.LookPath("sudo")
	if err != nil {
		ui.Hint("no sudo found — acting on a user-level service instead of the system one")
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	fmt.Println("The system-wide service needs root — elevating with sudo…")
	// The absolute self path means sudo's secure_path cannot hide it; the config path is forwarded
	// so the elevated process reads and writes this user's config, and the unit it writes runs
	// `microteams run --config <that>` as this user.
	args := append([]string{self}, os.Args[1:]...)
	if !hasFlag(os.Args[1:], "--config") {
		args = append(args, "--config", cfgPath)
	}
	cmd := exec.Command(sudo, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			os.Exit(exit.ExitCode())
		}
		return err
	}
	os.Exit(0)
	return nil
}

// hasFlag reports whether argv already carries the flag (as `--flag` or `--flag=value`).
func hasFlag(argv []string, flag string) bool {
	for _, a := range argv {
		if a == flag || strings.HasPrefix(a, flag+"=") {
			return true
		}
	}
	return false
}
