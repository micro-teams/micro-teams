package daemoncmd

// `login` and `logout`: who this machine is.
//
// Login is the device flow: the machine registers, prints a link, and on a person's approval stores
// a durable credential. The server URL is remembered (installers may pre-set it), so it is given at
// most once. Logout stops the connector and removes it from boot first, because a connector that
// keeps running holds the old credential in memory while nothing on disk says so.

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/auth"
	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/microteams/cli/internal/ui"
)

func loginCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "login [server-url]",
		Short: "Log this machine in and store its credential",
		Long: "Registers this machine with the server, prints a link for you to open and\n" +
			"approve in a browser, and on approval stores a durable credential.\n" +
			"The server URL is remembered (installers may pre-set it), so it only has to\n" +
			"be given once.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if _, err := doLogin(*cfgPath, firstArg(args)); err != nil {
				return err
			}
			ui.OK("Logged in.")
			ui.Hint("`microteams start` to connect")
			return nil
		},
	})
}

func logoutCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	return withConfig(&cobra.Command{
		Use:   "logout",
		Short: "Forget this machine's credential (stops the connector first)",
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := config.Load(*cfgPath)
			if err != nil || cfg.Token == "" {
				fmt.Println("Already logged out.")
				return nil
			}
			if _, found := service.Installed(*cfgPath); found {
				if err := stopService(*cfgPath, false, "stop", "uninstall"); err != nil {
					return fmt.Errorf("could not stop the connector, so the credential was kept: %w", err)
				}
			}
			cfg.Token = ""
			cfg.MachineID = ""
			if err := config.Save(*cfgPath, cfg); err != nil {
				return err
			}
			ui.OK("Logged out; the connector is stopped and no longer starts at boot.")
			ui.Hint("sessions on this machine keep running · `microteams login` to log in again")
			return nil
		},
	})
}

// doLogin runs the device flow and persists the result. serverArg overrides the stored server; an
// empty serverArg requires a stored one (e.g. from install.sh).
func doLogin(cfgPath, serverArg string) (*config.Config, error) {
	cfg, _ := config.Load(cfgPath)
	if cfg == nil {
		cfg = &config.Config{}
	}
	if serverArg != "" {
		cfg.Base = serverArg
	}
	if cfg.Base == "" {
		return nil, fmt.Errorf("no server known yet — run `microteams login <server-url>` once (installers can pre-set it)")
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

func firstArg(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}
