// Command microteams is the single binary a user installs to attach a machine to a
// server. To a human it is just `microteams` — `microteams login` to log in,
// `microteams start` to stay connected in the background. The agent's tools for
// talking to the workspace live under `microteams api`; that command tree is defined by a
// server-supplied applet (see internal/commandapplet), fetched on demand, so it can evolve
// without shipping a new binary. There is deliberately no separate "daemon" the user must know
// about. The resident service runs the MultiPath client beside it (internal/mpclient), and
// `microteams api` sends its requests through that client while it has a live session.
//
// newRoot() builds the whole command tree except the server-defined commands under `api`, which
// main loads only when they are asked for.
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/apiauth"
	"github.com/micro-teams/micro-connector/cli/commandapplet"
	"github.com/micro-teams/microteams/cli/internal/acpscreen"
	"github.com/micro-teams/microteams/cli/internal/daemoncmd"
	"github.com/micro-teams/microteams/cli/internal/host"
	"github.com/micro-teams/microteams/cli/internal/mpclient"
	"github.com/micro-teams/microteams/cli/internal/mtbrand"
	"github.com/micro-teams/microteams/cli/internal/state"
)

// Declare who this connector is before anything reads a path or an environment variable. See
// internal/mtbrand for why this is not a detail.
func init() { mtbrand.Use() }

// version is overridable at link time:
//
//	-ldflags "-X main.version=1.2.3"
var version = "dev"

func main() {
	if err := daemoncmd.AsInvokingUser(); err != nil {
		fmt.Fprintln(os.Stderr, "microteams:", err)
		os.Exit(1)
	}
	root, apiCmd := newRoot()

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

// newRoot returns the root command and its `api` group.
func newRoot() (root, apiCmd *cobra.Command) {
	root = &cobra.Command{
		Use:   "microteams",
		Short: "Connect this machine so your microteams sessions can run on it",
		Long: "microteams connects this machine to your microteams workspace so your sessions can " +
			"run here and you can use them from the web. Log in once and it stays connected in the " +
			"background. `microteams api` is the agent's tools for talking to your workspace.",
		Version:       version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.CompletionOptions.DisableDefaultCmd = true

	// Tell the host what to answer when the control plane asks which build this machine runs.
	host.Build = version

	for _, c := range daemoncmd.Commands() {
		root.AddCommand(c)
	}
	// The terminal front end for ACP agents (dsh), run inside an agent screen by the dsh driver;
	// nothing a person types.
	acp := acpscreen.Command(version)
	acp.Hidden = true
	root.AddCommand(acp)

	apiCmd = &cobra.Command{
		Use:   "api",
		Short: "The agent's tools for talking to your workspace",
		Long: "Commands the agent uses to act in your workspace — post to a group, read and write\n" +
			"documents, and so on. The set is defined by your server and fetched on demand, so it\n" +
			"stays current without updating this program.",
	}
	root.AddCommand(apiCmd)
	return root, apiCmd
}

// apiClient is the HTTP client every `microteams api` call goes out on: authenticated by the
// library, and carried by the resident service's MultiPath client while that has a live session
// (internal/mpclient), so a command reaches the server over every line as the service does. With no
// such client the call goes to the server directly, and stderr says why.
func apiClient() (*http.Client, error) {
	addr, err := mpclient.Lookup(state.CurrentClient(filepath.Join(configDir(), "config.json")))
	if err != nil {
		fmt.Fprintf(os.Stderr, "microteams: %v; sending directly\n", err)
		return apiauth.ClientOver(nil)
	}
	return apiauth.ClientOver(mpclient.Transport(addr))
}

// loadAPICommands fetches the CLI applet and hangs its commands under apiCmd.
func loadAPICommands(apiCmd *cobra.Command) error {
	client, err := apiClient()
	if err != nil {
		return err
	}
	base, err := apiauth.APIBase()
	if err != nil {
		return err
	}
	source, err := fetchCLIApplet(client, base)
	if err != nil {
		return err
	}
	applet, err := commandapplet.Load(source, commandapplet.Options{
		Client:  client,
		APIBase: base,
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
func fetchCLIApplet(client *http.Client, base string) (string, error) {
	cache := filepath.Join(configDir(), "cli-applet.js")

	// Why it failed, for the messages below: the reader is often an agent that cannot investigate.
	reason := "no response"
	resp, err := client.Get(base + "/agent/cli-applet")
	switch {
	case err != nil:
		reason = err.Error()
	default:
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			data, rerr := io.ReadAll(resp.Body)
			switch {
			case rerr != nil:
				reason = rerr.Error()
			case len(data) == 0:
				reason = "the server sent an empty applet"
			default:
				_ = os.MkdirAll(filepath.Dir(cache), 0o700)
				_ = os.WriteFile(cache, data, 0o600)
				return string(data), nil
			}
		} else {
			reason = fmt.Sprintf("the server answered %d", resp.StatusCode)
		}
	}
	if data, cerr := os.ReadFile(cache); cerr == nil {
		fmt.Fprintf(os.Stderr, "microteams: could not fetch the CLI applet from %s (%s); using the copy cached at %s\n", base, reason, cache)
		return string(data), nil
	}
	return "", fmt.Errorf(
		"could not fetch the CLI applet from %s (%s), and no cached copy at %s", base, reason, cache)
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
