package daemoncmd

// The command forms the flat verbs replace, kept for one version as hidden aliases: each prints the
// new form on stderr and then runs it, so a script or a habit keeps working while it learns.
//
//	auth login | auth logout          login | logout
//	link connect | link auto-connect  start | enable
//	link disconnect                   stop
//	link no-auto-connect              disable
//	proxy …                           config proxy …
//
// An alias is the new command built again under the old name.

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func authAlias(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	group := &cobra.Command{Use: "auth", Short: "Log this machine in or out", Hidden: true}
	group.AddCommand(
		alias(loginCmd(cfgPath, withConfig), "auth login", "login"),
		alias(logoutCmd(cfgPath, withConfig), "auth logout", "logout"),
	)
	return group
}

func linkAlias(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	group := &cobra.Command{Use: "link", Short: "Manage this machine's connection to the server", Hidden: true}
	group.AddCommand(
		alias(startCmd(cfgPath, withConfig), "link connect", "start"),
		alias(enableCmd(cfgPath, withConfig), "link auto-connect", "enable"),
		alias(stopCmd(cfgPath, withConfig), "link disconnect", "stop"),
		alias(disableCmd(cfgPath, withConfig), "link no-auto-connect", "disable"),
	)
	return group
}

// alias renames c to the last word of oldPath, hides it, and makes it (and its subcommands) print
// the new form and rewrite os.Args to it before running, so an elevated re-run is the new form.
func alias(c *cobra.Command, oldPath, newPath string) *cobra.Command {
	oldWords := strings.Fields(oldPath)
	c.Use = oldWords[len(oldWords)-1] + strings.TrimPrefix(c.Use, strings.Fields(c.Use)[0])
	c.Hidden = true
	c.PersistentPreRun = func(cmd *cobra.Command, _ []string) {
		was := strings.TrimSpace(strings.TrimPrefix(cmd.CommandPath(), cmd.Root().Name()))
		now := newPath + strings.TrimPrefix(was, oldPath)
		fmt.Fprintf(os.Stderr, "`microteams %s` is now `microteams %s`; the old form goes away in the next version.\n", was, now)
		os.Args = canonicalArgs(os.Args, oldWords, strings.Fields(newPath))
	}
	return c
}

// canonicalArgs replaces the words of the old command path in argv with the new ones. Words are
// matched in order, so flags may sit between them.
func canonicalArgs(argv, oldWords, newWords []string) []string {
	var out []string
	matched := 0
	for i, a := range argv {
		if i > 0 && matched < len(oldWords) && a == oldWords[matched] {
			matched++
			if matched == len(oldWords) {
				out = append(out, newWords...)
			}
			continue
		}
		out = append(out, a)
	}
	if matched < len(oldWords) {
		return argv
	}
	return out
}
