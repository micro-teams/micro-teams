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
// The sessions on a machine belong to its tmux server, which outlives the connector process, so no
// command here ends them except `uninstall`. The one way a stop can still end them is a service unit
// written by an older build; every command that stops or starts the service rewrites such a unit
// when it can, and otherwise asks once before going ahead.
//
// The forms these commands replace (`auth …`, `link connect|disconnect|auto-connect|
// no-auto-connect`, `proxy …`) are hidden aliases that print the new form and then run it.
//
//   - Commands() []*cobra.Command is every lifecycle command, visible and hidden, to add to the
//     `microteams` root:
//
//     for _, c := range daemoncmd.Commands() { root.AddCommand(c) }
package daemoncmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/micro-teams/micro-connector/cli/brand"
	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/microteams/cli/internal/host"
	"github.com/micro-teams/microteams/cli/internal/netcfg"
)

// Commands returns every lifecycle command to add to the `microteams` root.
func Commands() []*cobra.Command {
	var cfgPath string
	withConfig := func(c *cobra.Command) *cobra.Command {
		c.Flags().StringVar(&cfgPath, "config", defaultConfig(), "path to this machine's microteams config")
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
		authAlias(&cfgPath, withConfig),
		linkAlias(&cfgPath, withConfig),
		alias(proxyCmd(&cfgPath, withConfig), "proxy", "config proxy"),
	}
}

// defaultConfig is the config of the person at the keyboard. Under sudo that is the invoking
// user's, not root's: the service runs as that user, and `sudo microteams restart` must act on the
// same machine as `microteams restart`.
func defaultConfig() string {
	name := os.Getenv("SUDO_USER")
	if os.Geteuid() != 0 || name == "" || name == "root" {
		return config.DefaultPath()
	}
	u, err := user.Lookup(name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "microteams: cannot find the home of %s (%v); using %s\n", name, err, config.DefaultPath())
		return config.DefaultPath()
	}
	base := filepath.Join(u.HomeDir, ".config")
	if runtime.GOOS == "darwin" {
		base = filepath.Join(u.HomeDir, "Library", "Application Support")
	}
	return filepath.Join(base, brand.Current.ConfigDir, "config.json")
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

// liveSessions asks tmux how many sessions this machine hosts. The state file is not asked: a tmux
// server that died since it was written would leave it claiming sessions nobody can open.
func liveSessions() (int, error) {
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
