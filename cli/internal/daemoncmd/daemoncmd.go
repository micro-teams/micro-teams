// Package daemoncmd wires the human-facing lifecycle of `microteams`. The mental
// model has two halves, mirrored by two command groups:
//
//	microteams auth …   who this machine is (login / logout)
//	microteams link …   whether it is connected (connect / disconnect / status /
//	                auto-connect / no-auto-connect)
//
// plus `microteams api` (the server's generated API) and `microteams uninstall`. Every
// command tries to meet the user where they are: connect logs you in first if
// needed, disconnect warns when screens are still running, and each success
// message says what to do next.
package daemoncmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/micro-teams/microteams/cli/internal/auth"
	"github.com/micro-teams/microteams/cli/internal/config"
	"github.com/micro-teams/microteams/cli/internal/service"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/ui"
	"github.com/micro-teams/microteams/cli/internal/update"
)

// Commands returns every lifecycle command to add to the `microteams` root.
func Commands() []*cobra.Command {
	var cfgPath string
	withConfig := func(c *cobra.Command) *cobra.Command {
		c.Flags().StringVar(&cfgPath, "config", config.DefaultPath(),
			"path to this machine's microteams config")
		return c
	}
	return []*cobra.Command{
		authCmd(&cfgPath, withConfig),
		linkCmd(&cfgPath, withConfig),
		statusCmd(&cfgPath, withConfig),
		runCmd(&cfgPath, withConfig),
		updateCmd(&cfgPath, withConfig),
		uninstallCmd(&cfgPath, withConfig),
	}
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

func authCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	login := withConfig(&cobra.Command{
		Use:   "login [server-url]",
		Short: "Log this machine in and store its credential",
		Long: "Registers this machine with the server, prints a link for you to open and\n" +
			"approve in a browser, and on approval stores a durable credential.\n" +
			"The server URL is remembered (installers may pre-set it), so it only has to\n" +
			"be given once.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			serverArg := ""
			if len(args) == 1 {
				serverArg = args[0]
			}
			if _, err := doLogin(*cfgPath, serverArg); err != nil {
				return err
			}
			ui.OK("Logged in.")
			ui.Hint("`microteams link connect` to connect · `microteams link auto-connect` to also reconnect on boot")
			return nil
		},
	})

	logout := withConfig(&cobra.Command{
		Use:   "logout",
		Short: "Forget this machine's credential (disconnects first)",
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := config.Load(*cfgPath)
			if err != nil || cfg.Token == "" {
				fmt.Println("Already logged out.")
				return nil
			}
			warnScreens(*cfgPath)
			_ = service.Control(*cfgPath, "stop")
			_ = service.Control(*cfgPath, "uninstall")
			cfg.Token = ""
			cfg.MachineID = ""
			if err := config.Save(*cfgPath, cfg); err != nil {
				return err
			}
			fmt.Println("Logged out and disconnected. `microteams auth login` to log in again.")
			return nil
		},
	})

	group := &cobra.Command{Use: "auth", Short: "Log this machine in or out"}
	group.AddCommand(login, logout)
	return group
}

// doLogin runs the device flow and persists the result. serverArg overrides the
// stored base; an empty serverArg requires a stored base (e.g. from install.sh).
func doLogin(cfgPath, serverArg string) (*config.Config, error) {
	cfg, _ := config.Load(cfgPath)
	if cfg == nil {
		cfg = &config.Config{}
	}
	if serverArg != "" {
		cfg.Base = serverArg
	}
	if cfg.Base == "" {
		return nil, fmt.Errorf("no server known yet — run `microteams auth login <server-url>` once (installers can pre-set it)")
	}
	res, err := auth.Login(context.Background(), cfg.Base, func(approveURL string) {
		fmt.Println("Open this link and approve this machine:")
		fmt.Println("\n    " + approveURL + "\n")
		fmt.Println("Waiting for approval…")
	})
	if err != nil {
		return nil, err
	}
	cfg.Token = res.Token
	cfg.MachineID = res.MachineID
	if err := config.Save(cfgPath, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// elevateToRoot re-executes this exact command under sudo when it is about to install
// the boot service and we are not already root. A *system* service is the right default
// — on a server it starts with no user logged in — whereas a user-level service (which a
// non-root install would produce) stops on logout and only makes sense on a personal
// client machine; that rarer case stays available via the hidden --user flag. If sudo is
// missing we fall back to a user service rather than fail. On success the elevated child
// does all the work and this process exits.
func elevateToRoot(userService bool, cfgPath string) error {
	if userService || os.Geteuid() == 0 {
		return nil
	}
	sudo, err := exec.LookPath("sudo")
	if err != nil {
		ui.Hint("no sudo found — installing a user-level service (it stops on logout; pass --user to silence)")
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	fmt.Println("Installing a system-wide service (needs root) — elevating with sudo…")
	fmt.Println("(pass --user for a user-level service instead, e.g. on a personal laptop)")
	// Re-run the same invocation verbatim as root; the absolute self path means sudo's
	// secure_path can't hide it. Inherit stdio so the login link, polling and any sudo
	// password prompt all work interactively.
	args := append([]string{self}, os.Args[1:]...)
	// Forward this user's config path so the elevated root reads/writes the SAME config
	// (where the installer recorded the server, and where the token lands — os.WriteFile
	// keeps it user-owned). The system unit then runs `microteams run --config <that>` as the
	// user (see service.New), so config + private tmux stay in the user's home.
	if !hasFlag(os.Args[1:], "--config") {
		args = append(args, "--config", cfgPath)
	}
	cmd := exec.Command(sudo, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

// hasFlag reports whether argv already carries the given flag (as `--flag` or
// `--flag=value`), so elevation doesn't append a duplicate.
func hasFlag(argv []string, flag string) bool {
	for _, a := range argv {
		if a == flag || strings.HasPrefix(a, flag+"=") {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

func linkCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var force bool
	var userService bool

	connect := withConfig(&cobra.Command{
		Use:   "connect [server-url]",
		Short: "Connect this machine to the server",
		Long: "Connects now (and, as a side effect of installing the background service,\n" +
			"also reconnects after a reboot — `microteams link no-auto-connect` turns that off).\n" +
			"If this machine is not logged in yet, the login flow runs first.\n\n" +
			"Installs a system-wide service by default (starts even with no user logged in),\n" +
			"elevating with sudo when needed. Use --user for a user-level service instead.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if err := elevateToRoot(userService, *cfgPath); err != nil {
				return err
			}
			serverArg := ""
			if len(args) == 1 {
				serverArg = args[0]
			}
			cfg, _ := config.Load(*cfgPath)
			if cfg == nil || cfg.Token == "" || serverArg != "" && cfg != nil && cfg.Base != serverArg {
				fmt.Println("Not logged in yet — starting login first.")
				var err error
				if cfg, err = doLogin(*cfgPath, serverArg); err != nil {
					return err
				}
				ui.OK("Logged in.")
			}
			_ = service.Control(*cfgPath, "install")
			if err := service.Control(*cfgPath, "start"); err != nil {
				return err
			}
			ui.OK("Connected. The server can now open screens on this machine.")
			ui.Hint("`microteams status` to check · `microteams link disconnect` to disconnect")
			return nil
		},
	})

	disconnect := withConfig(&cobra.Command{
		Use:   "disconnect",
		Short: "Disconnect from the server",
		RunE: func(_ *cobra.Command, _ []string) error {
			if n := state.Screens(*cfgPath); n > 0 && !force {
				fmt.Printf("This machine is running %d session(s); disconnecting will stop them.\n", n)
				if !confirm("Disconnect anyway?") {
					fmt.Println("Aborted. (Use --force to skip this prompt.)")
					return nil
				}
			}
			if err := service.Control(*cfgPath, "stop"); err != nil {
				return err
			}
			fmt.Println("Disconnected. `microteams link connect` to reconnect.")
			fmt.Println("(Note: it will still reconnect after a reboot; `microteams link no-auto-connect` prevents that.)")
			return nil
		},
	})
	disconnect.Flags().BoolVar(&force, "force", false, "disconnect even if screens are running")

	autoConnect := withConfig(&cobra.Command{
		Use:   "auto-connect [server-url]",
		Short: "Connect now and reconnect automatically on every boot",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return connect.RunE(cmd, args)
		},
	})

	noAutoConnect := withConfig(&cobra.Command{
		Use:   "no-auto-connect",
		Short: "Disconnect and stop reconnecting on boot",
		RunE: func(_ *cobra.Command, _ []string) error {
			if n := state.Screens(*cfgPath); n > 0 && !force {
				fmt.Printf("This machine is running %d session(s); this will stop them.\n", n)
				if !confirm("Continue?") {
					fmt.Println("Aborted. (Use --force to skip this prompt.)")
					return nil
				}
			}
			_ = service.Control(*cfgPath, "stop")
			if err := service.Control(*cfgPath, "uninstall"); err != nil {
				return err
			}
			fmt.Println("Disconnected and removed from boot. `microteams link connect` to connect again.")
			return nil
		},
	})
	noAutoConnect.Flags().BoolVar(&force, "force", false, "proceed even if screens are running")

	// Hidden opt-out from the system-service default (rare: a personal client machine).
	// Bound to the same var on both service-installing commands; only the invoked one parses.
	for _, c := range []*cobra.Command{connect, autoConnect} {
		c.Flags().BoolVar(&userService, "user", false, "install a user-level service instead of system-wide")
		_ = c.Flags().MarkHidden("user")
	}

	group := &cobra.Command{Use: "link", Short: "Manage this machine's connection to the server"}
	group.AddCommand(connect, disconnect, autoConnect, noAutoConnect)
	return group
}

// statusCmd is the top-level `microteams status`: a compact, colored overview of
// login, connection, and the screens this machine is hosting.
func statusCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "status",
		Short: "Show login, connection, and running sessions",
		RunE: func(_ *cobra.Command, _ []string) error {
			ui.Heading("microteams")
			cfg, err := config.Load(*cfgPath)
			if err != nil || cfg.Token == "" {
				ui.Field("login", ui.Red("not logged in"))
				ui.Hint("run `microteams auth login <server-url>` to get started")
				return nil
			}
			ui.Field("login", ui.Green("logged in"))
			ui.Field("machine", ui.Dim(cfg.MachineID))
			ui.Field("server", cfg.Base)

			st, serr := service.Status(*cfgPath)
			switch {
			case serr != nil:
				ui.Field("link", ui.Yellow("not connected"))
			case st == "running":
				ui.Field("link", ui.Green("connected"))
			default:
				ui.Field("link", ui.Yellow(st))
			}

			n := state.Screens(*cfgPath)
			screens := ui.Dim("none")
			if n > 0 {
				screens = ui.Bold(fmt.Sprintf("%d", n)) + " running"
			}
			ui.Field("screens", screens)

			if serr != nil {
				ui.Hint("run `microteams link connect` to connect")
			}
			return nil
		},
	})
}

// ---------------------------------------------------------------------------
// the rest
// ---------------------------------------------------------------------------

func runCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:    "run",
		Short:  "Stay connected in the foreground (used by the service manager)",
		Hidden: true,
		RunE: func(_ *cobra.Command, _ []string) error {
			return service.RunForeground(*cfgPath)
		},
	})
}

// updateCmd updates the `microteams` binary to the latest published build. If the
// background service is running it merely SIGNALS it (SIGUSR2): the update must
// happen inside that process so its private tmux — and the tasks running in it —
// survive the binary swap and the in-place hand-off (syscall.Exec). Only when no
// service is running (nothing to preserve) does it download + replace directly.
func updateCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "update",
		Short: "Update the microteams binary to the latest published build",
		RunE: func(_ *cobra.Command, _ []string) error {
			if pid := state.PID(*cfgPath); pid > 0 {
				// A live service owns the tmux + tasks: let it update itself in-process
				// and hand off, so nothing running is killed.
				if err := syscall.Kill(pid, syscall.SIGUSR2); err != nil {
					return fmt.Errorf("signal running service (pid %d): %w", pid, err)
				}
				ui.OK("Update signalled to the running service (pid %d).", pid)
				ui.Hint("it downloads, verifies and hands off in place — running screens are preserved")
				return nil
			}
			// No running service: nothing to preserve — download + replace directly.
			cfg, err := config.Load(*cfgPath)
			if err != nil || cfg.Base == "" {
				return fmt.Errorf("no server configured — run `microteams auth login` first")
			}
			fmt.Println("Downloading the latest microteams…")
			tmp, err := update.Fetch(context.Background(), cfg.Base)
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
			ui.OK("microteams updated.")
			ui.Hint("no service was running; the new binary is in place and used from now on")
			return nil
		},
	})
}

func uninstallCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "uninstall",
		Short: "Remove the microteams CLI from this machine (service, config, and binary)",
		RunE: func(_ *cobra.Command, _ []string) error {
			warnScreens(*cfgPath)
			// Capture the live connector's pid (recorded by `microteams run`) BEFORE anything,
			// so we can guarantee it is actually stopped.
			pid := state.RawPID(*cfgPath)
			_ = service.Control(*cfgPath, "stop")
			_ = service.Control(*cfgPath, "uninstall")
			// A running connector whose config+binary were deleted is the worst possible
			// state: it keeps using stale in-memory credentials, can't be managed, and
			// looks "connected" while the server sees it offline. So guarantee the process
			// is gone before deleting anything. `systemctl stop` of a *system* unit needs
			// root and silently no-ops otherwise — but the process itself runs as this
			// user, so we can stop it directly. If we truly cannot (a root-owned process),
			// fail loudly and leave every file intact so nothing is orphaned.
			if err := stopProcess(pid); err != nil {
				return fmt.Errorf(
					"the microteams connector is still running (pid %d) and could not be stopped; "+
						"nothing was removed — re-run as: sudo microteams uninstall", pid)
			}
			if err := os.RemoveAll(config.Dir()); err != nil {
				return fmt.Errorf("remove config %s: %w", config.Dir(), err)
			}
			exe, err := os.Executable()
			if err != nil {
				return err
			}
			if err := os.Remove(exe); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove binary %s: %w (delete it manually)", exe, err)
			}
			fmt.Println("microteams uninstalled — service, config, and binary removed.")
			return nil
		},
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func warnScreens(cfgPath string) {
	if n := state.Screens(cfgPath); n > 0 {
		fmt.Printf("Note: %d running session(s) will be stopped.\n", n)
	}
}

// procAlive reports whether pid names a live process. EPERM means it exists but we may
// not signal it (a differently-owned process) — still alive; ESRCH means it is gone.
func procAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// stopProcess ensures pid is no longer running: SIGTERM (so the host tears its tmux
// down cleanly), then SIGKILL as a backstop, polling briefly between. Returns nil once
// the process is gone (or was never there), or an error if it is still alive after both
// — e.g. we lack the privilege to signal a differently-owned process.
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

func confirm(q string) bool {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return false
	}
	fmt.Printf("%s [y/N]: ", q)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	return line == "y" || line == "yes"
}

