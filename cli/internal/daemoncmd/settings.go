package daemoncmd

// `config`: this machine's own settings, of which there is one, the proxy.
//
// The proxy lives in a file this product owns and the connector applies to itself at startup, so
// it survives being started by an init system that scrubs the environment, which a proxy set in a
// shell profile never reaches. See internal/netcfg.
//
//	microteams config                         every setting
//	microteams config proxy                   the proxy
//	microteams config proxy set <url>         use it (http:// or socks5://)
//	microteams config proxy no-proxy <list>   hosts reached directly, as in NO_PROXY
//	microteams config proxy clear             stop using one

import (
	"fmt"
	"net/url"

	"github.com/spf13/cobra"

	"github.com/micro-teams/microteams/cli/internal/netcfg"
	"github.com/micro-teams/microteams/cli/internal/ui"
)

func configCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	c := withConfig(&cobra.Command{
		Use:   "config",
		Short: "Show or change this machine's settings (proxy)",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			showProxy(*cfgPath)
			return nil
		},
	})
	c.AddCommand(proxyCmd(cfgPath, withConfig))
	return c
}

func proxyCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	cmd := withConfig(&cobra.Command{
		Use:   "proxy",
		Short: "Show or set the proxy this machine's connector uses",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			showProxy(*cfgPath)
			return nil
		},
	})
	// Every subcommand gets --config too; on the parent alone, `… set <url> --config X` would fail
	// with "unknown flag".
	set := withConfig(&cobra.Command{
		Use:   "set <url>",
		Short: "Use this proxy (http:// or socks5://), for the service too",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			raw := args[0]
			parsed, err := url.Parse(raw)
			if err != nil || parsed.Scheme == "" || parsed.Host == "" {
				return fmt.Errorf("not a usable proxy URL: %s (want e.g. http://host:3128)", raw)
			}
			s := netcfg.Load(*cfgPath)
			s.Proxy = raw
			if err := netcfg.Save(*cfgPath, s); err != nil {
				return err
			}
			ui.OK("Proxy set to %s", redactProxy(raw))
			ui.Hint("`microteams restart` to apply it (sessions keep running)")
			return nil
		},
	})
	noProxy := withConfig(&cobra.Command{
		Use:   "no-proxy <list>",
		Short: "Hosts to reach directly (comma-separated), as in NO_PROXY",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			s := netcfg.Load(*cfgPath)
			s.NoProxy = args[0]
			if err := netcfg.Save(*cfgPath, s); err != nil {
				return err
			}
			ui.OK("Direct for: %s", args[0])
			ui.Hint("`microteams restart` to apply it (sessions keep running)")
			return nil
		},
	})
	clear := withConfig(&cobra.Command{
		Use:   "clear",
		Short: "Stop using a configured proxy",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			if err := netcfg.Save(*cfgPath, netcfg.Settings{}); err != nil {
				return err
			}
			ui.OK("Proxy cleared.")
			ui.Hint("`microteams restart` to apply it (sessions keep running)")
			return nil
		},
	})
	cmd.AddCommand(set, noProxy, clear)
	return cmd
}

func showProxy(cfgPath string) {
	s := netcfg.Load(cfgPath)
	if s.Proxy == "" {
		ui.Field("proxy", ui.Dim("not set"))
		// The environment may still provide one when run by hand; saying so prevents the obvious
		// wrong conclusion when the service behaves differently.
		if env := netcfg.Effective("https://example.invalid"); env != "" {
			ui.Field("environment", env)
			ui.Hint("that comes from this shell — a service started by the system will NOT have it")
		}
		ui.Hint("`microteams config proxy set http://user:pass@host:port` to configure one")
		return
	}
	ui.Field("proxy", redactProxy(s.Proxy))
	if s.NoProxy != "" {
		ui.Field("no proxy", s.NoProxy)
	}
	ui.Hint("applies to the connection, the API and the lines · `microteams config proxy clear` to remove")
}

// redactProxy hides the password in a proxy URL. These routinely carry credentials, and `status`
// prints this string, which people paste into chats when asking for help.
func redactProxy(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return parsed.Redacted()
}
