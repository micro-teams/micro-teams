// Package daemoncmd is the human-facing lifecycle of `microteams`: one flat set of verbs, each
// saying what to do next when it succeeds.
//
//	microteams login [server-url]     who this machine is (device flow); logout forgets it
//	microteams start | stop | restart the connector, now; sessions keep running through all three
//	microteams enable | disable       whether it starts at boot (or login)
//	microteams status [--json]        login, connection, service, sessions and lines on one screen
//	microteams logs [-f]              the connector's own log
//	microteams config                 this machine's settings (proxy)
//	microteams update | uninstall     the binary itself; only uninstall ends the sessions
//
// The sessions on a machine belong to its tmux server, which outlives the connector process (the
// service unit stops only the connector: KillMode=process), so no command here ends them except
// `uninstall`.
//
// Under sudo, a command acts for the person who ran sudo: the service runs as them, and their
// config, state file, log and tmux are the ones that matter. tmux is reached only as that person,
// so a root process never claims to know how many sessions they have.
//
//   - AsInvokingUser() error, called before anything resolves a path: under sudo, makes this
//     process's home that of SUDO_USER, so every path derived from it is theirs. Nothing to do
//     otherwise; an error when SUDO_USER names nobody.
//
//   - Commands() []*cobra.Command is every lifecycle command, visible and hidden (`run`, which the
//     service manager starts), to add to the `microteams` root:
//
//     if err := daemoncmd.AsInvokingUser(); err != nil { ... }
//     for _, c := range daemoncmd.Commands() { root.AddCommand(c) }
package daemoncmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/microteams/cli/internal/host"
	"github.com/micro-teams/microteams/cli/internal/netcfg"
	"github.com/micro-teams/microteams/cli/internal/state"
)

// Commands returns every lifecycle command to add to the `microteams` root.
func Commands() []*cobra.Command {
	var cfgPath string
	withConfig := func(c *cobra.Command) *cobra.Command {
		c.Flags().StringVar(&cfgPath, "config", config.DefaultPath(), "path to this machine's microteams config")
		return c
	}
	return []*cobra.Command{
		loginCmd(&cfgPath, withConfig),
		logoutCmd(&cfgPath, withConfig),
		startCmd(&cfgPath, withConfig),
		stopCmd(&cfgPath, withConfig),
		restartCmd(&cfgPath, withConfig),
		enableCmd(&cfgPath, withConfig),
		disableCmd(&cfgPath, withConfig),
		statusCmd(&cfgPath, withConfig),
		logsCmd(&cfgPath, withConfig),
		configCmd(&cfgPath, withConfig),
		updateCmd(&cfgPath, withConfig),
		uninstallCmd(&cfgPath, withConfig),
		runCmd(&cfgPath, withConfig),
	}
}

// sudoUser is the person who ran this process through sudo, or "" when it was not (or root did).
func sudoUser() string {
	if name := os.Getenv("SUDO_USER"); os.Geteuid() == 0 && name != "root" {
		return name
	}
	return ""
}

// AsInvokingUser gives this process SUDO_USER's home. XDG_CONFIG_HOME is kept when sudo kept it: it
// is then that person's own.
func AsInvokingUser() error {
	name := sudoUser()
	if name == "" {
		return nil
	}
	u, err := user.Lookup(name)
	if err != nil {
		return fmt.Errorf("run through sudo by %s, who has no account here: %w", name, err)
	}
	if err := os.Setenv("HOME", u.HomeDir); err != nil {
		return err
	}
	runtimeDir := filepath.Join("/run/user", u.Uid)
	if _, err := os.Stat(runtimeDir); err != nil {
		return os.Unsetenv("XDG_RUNTIME_DIR")
	}
	return os.Setenv("XDG_RUNTIME_DIR", runtimeDir)
}

// hostRunner is what this product's service does: dial the backend and let it open screens here.
func hostRunner(cfgPath string) service.Runner {
	return func(ctx context.Context) error {
		cfg, err := host.LoadConfig(cfgPath)
		if err != nil {
			return err
		}
		h, err := host.New(cfg, cfgPath)
		if err != nil {
			return err
		}
		return h.Run(ctx)
	}
}

func runCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:    "run",
		Short:  "Stay connected in the foreground (used by the service manager)",
		Hidden: true,
		RunE: func(_ *cobra.Command, _ []string) error {
			// Before anything dials. A service is started with an environment we do not control
			// (Debian's `service` uses `env -i`; a systemd unit inherits nobody's shell), so the
			// machine's own proxy setting is applied by this process to itself — and it must happen
			// here, because http.ProxyFromEnvironment reads the environment once and remembers it.
			netcfg.Apply(*cfgPath)
			return service.RunForeground(*cfgPath, hostRunner(*cfgPath))
		},
	})
}

// liveSessions asks tmux how many sessions this machine hosts. The state file's count is not asked:
// a tmux server that died since it was written would leave it claiming sessions nobody can open.
// The tmux asked is the running service's: its state file says what it resolved its tmux from, and
// this process takes that on (state.Tmux), because a shell's environment ($MICROTEAMS_TMUX,
// $XDG_RUNTIME_DIR, the temp dir) may resolve another binary or socket. Under sudo it does not
// answer: the sessions are the invoking user's, in a tmux root may not find.
func liveSessions(cfgPath string) (int, error) {
	if t := state.CurrentTmux(cfgPath); t.Bin != "" {
		if err := t.Apply(); err != nil {
			return 0, err
		}
	}
	if name := sudoUser(); name != "" {
		return 0, fmt.Errorf("the sessions belong to %s and are counted only as %s, not through sudo", name, name)
	}
	tm, err := terminal.NewManager()
	if err != nil {
		return 0, err
	}
	return tm.LiveSessions()
}

// confirm asks a yes/no question on the terminal; without one the answer is no.
func confirm(q string) bool {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return false
	}
	fmt.Printf("%s [y/N]: ", q)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	return line == "y" || line == "yes"
}
