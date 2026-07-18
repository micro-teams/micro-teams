// Command microteams is the single binary a user installs to attach a machine to a
// server. To a human it is just `microteams` — `microteams auth login` to log in,
// `microteams link auto-connect` to stay connected in the background. The agent's tools for
// talking to the workspace live under `microteams api`; that command tree is defined by a
// server-supplied applet (see internal/commandapplet), fetched on demand, so it can evolve
// without shipping a new binary. There is deliberately no separate "daemon" the user must know
// about.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/micro-teams/microteams/cli/internal/apiauth"
	"github.com/micro-teams/microteams/cli/internal/commandapplet"
	"github.com/micro-teams/microteams/cli/internal/daemoncmd"
)

// version is overridable at link time:
//
//	-ldflags "-X main.version=1.2.3"
var version = "dev"

func main() {
	root := &cobra.Command{
		Use:     "microteams",
		Short:   "Connect this machine so your microteams sessions can run on it",
		Long: "microteams connects this machine to your microteams workspace so your sessions can " +
			"run here and you can use them from the web. Log in once and it stays connected in the " +
			"background. `microteams api` is the agent's tools for talking to your workspace.",
		Version:       version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.CompletionOptions.DisableDefaultCmd = true

	// The user-facing service lifecycle: auth / link / status / run / update / uninstall.
	for _, c := range daemoncmd.Commands() {
		root.AddCommand(c)
	}

	apiCmd := &cobra.Command{
		Use:   "api",
		Short: "The agent's tools for talking to your workspace",
		Long: "Commands the agent uses to act in your workspace — post to a group, read and write\n" +
			"documents, and so on. The set is defined by your server and fetched on demand, so it\n" +
			"stays current without updating this program.",
	}
	root.AddCommand(apiCmd)

	// Only `microteams api …` needs the applet; fetching it costs a round trip, so the daemon
	// commands (which must work offline / on a fresh box) never trigger it.
	if len(os.Args) > 1 && os.Args[1] == "api" {
		if err := loadAPICommands(apiCmd); err != nil {
			fmt.Fprintln(os.Stderr, "microteams api:", err)
			os.Exit(1)
		}
	}

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "microteams:", err)
		os.Exit(1)
	}
}

// loadAPICommands fetches the CLI applet and hangs its commands under apiCmd.
func loadAPICommands(apiCmd *cobra.Command) error {
	source, err := fetchCLIApplet()
	if err != nil {
		return err
	}
	applet, err := commandapplet.Load(source, commandapplet.Options{
		Client:  apiauth.Client(),
		APIBase: apiauth.APIBase(),
		FsRoot:  os.Getenv("MICROTEAMS_FS_ROOT"),
	})
	if err != nil {
		return err
	}
	for _, c := range applet.CobraCommands() {
		apiCmd.AddCommand(c)
	}
	return nil
}

// fetchCLIApplet returns the CLI applet source: the server's current copy when reachable (cached
// for next time), else the last cached copy. The endpoint is public, so no credential is needed to
// fetch it — the applet authenticates its own calls.
func fetchCLIApplet() (string, error) {
	base := apiauth.APIBase()
	cache := filepath.Join(configDir(), "cli-applet.js")

	resp, err := apiauth.Client().Get(base + "/agent/cli-applet")
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			data, rerr := io.ReadAll(resp.Body)
			if rerr == nil && len(data) > 0 {
				_ = os.MkdirAll(filepath.Dir(cache), 0o700)
				_ = os.WriteFile(cache, data, 0o600)
				return string(data), nil
			}
		}
	}
	if data, cerr := os.ReadFile(cache); cerr == nil {
		return string(data), nil
	}
	return "", fmt.Errorf("could not fetch the CLI applet from %s (and no cached copy)", base)
}

func configDir() string {
	if dir := os.Getenv("MICROTEAMS_CONFIG_DIR"); dir != "" {
		return dir
	}
	if base, err := os.UserConfigDir(); err == nil {
		return filepath.Join(base, "microteams")
	}
	return filepath.Join(os.TempDir(), "microteams")
}
