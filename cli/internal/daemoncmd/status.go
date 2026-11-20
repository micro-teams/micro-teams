package daemoncmd

// `status`: everything a person asks when a machine misbehaves, on one screen — login, connection,
// the service, the sessions and every network line — or the same as JSON with --json.
//
// Three sources answer, and each answers only what it knows: the service manager whether the
// process runs, the process (through the state file) whether it reached the server, and tmux how
// many sessions there are. collect asks all three into one report; the text and the JSON are two
// renderings of it.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/service"
	"github.com/micro-teams/microteams/cli/internal/host"
	"github.com/micro-teams/microteams/cli/internal/mpclient"
	"github.com/micro-teams/microteams/cli/internal/netcfg"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/ui"
	"github.com/micro-teams/multipath/go/client"
)

// report is what `status` knows. Its JSON form is the `--json` output.
type report struct {
	LoggedIn     bool           `json:"loggedIn"`
	Machine      string         `json:"machine,omitempty"`
	Server       string         `json:"server,omitempty"`
	Connection   connection     `json:"connection"`
	Service      svc            `json:"service"`
	Sessions     *int           `json:"sessions"` // nil when tmux could not be asked
	SessionErr   string         `json:"sessionsError,omitempty"`
	Multipath    *client.Status `json:"multipath,omitempty"`
	MultipathErr string         `json:"multipathError,omitempty"`
	Proxy        string         `json:"proxy,omitempty"`
}

type connection struct {
	Connected bool       `json:"connected"`
	Since     *time.Time `json:"since,omitempty"`
	Error     string     `json:"error,omitempty"`
}

type svc struct {
	Installed bool   `json:"installed"`
	Scope     string `json:"scope,omitempty"` // "user" or "system"
	State     string `json:"state"`           // running, stopped, not installed or unknown
	Advice    string `json:"advice,omitempty"`
}

func statusCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var asJSON bool
	c := withConfig(&cobra.Command{
		Use:   "status",
		Short: "Show login, connection, service, sessions and lines",
		RunE: func(_ *cobra.Command, _ []string) error {
			r := collect(*cfgPath)
			if asJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(r)
			}
			render(os.Stdout, r)
			return nil
		},
	})
	c.Flags().BoolVar(&asJSON, "json", false, "print the status as JSON")
	return c
}

// collect asks the config, the service manager, the state file, tmux and the multipath client.
func collect(cfgPath string) report {
	var r report
	if cfg, err := config.Load(cfgPath); err == nil && cfg.Token != "" {
		r.LoggedIn, r.Machine, r.Server = true, cfg.MachineID, cfg.Base
	}

	if userService, found := service.Installed(cfgPath); found {
		r.Service.Installed = true
		r.Service.Scope = map[bool]string{true: "user", false: "system"}[userService]
		if current, err := service.UnitCurrent(cfgPath); err == nil && !current {
			r.Service.Advice = host.UnitAdvice
		}
	}
	st, err := service.Status(cfgPath)
	if err != nil {
		st = "unknown: " + err.Error()
	}
	r.Service.State = st

	if st == "running" || state.PID(cfgPath) > 0 {
		link := state.CurrentLink(cfgPath)
		r.Connection = connection{Connected: link.Up, Error: link.Error}
		if !link.Since.IsZero() {
			r.Connection.Since = &link.Since
		}
	}

	if n, err := liveSessions(); err != nil {
		r.SessionErr = err.Error()
	} else {
		r.Sessions = &n
	}

	if c := state.CurrentClient(cfgPath); c.Status != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if mst, err := mpclient.Status(ctx, c.Status); err != nil {
			r.MultipathErr = err.Error()
		} else {
			r.Multipath = &mst
		}
	}

	if px := netcfg.Load(cfgPath); px.Proxy != "" {
		r.Proxy = redactProxy(px.Proxy)
	}
	return r
}

// render prints the report for a person.
func render(w io.Writer, r report) {
	field := func(label, value string) { fmt.Fprintf(w, "  %s  %s\n", ui.Dim(fmt.Sprintf("%-10s", label)), value) }
	hint := func(s string) { fmt.Fprintln(w, "  "+ui.Dim(s)) }

	fmt.Fprintln(w, ui.Accent(ui.Bold("microteams")))
	if !r.LoggedIn {
		field("login", ui.Red("not logged in"))
		hint("`microteams login <server-url>` to get started")
		return
	}
	field("login", ui.Green("logged in")+" "+ui.Dim(r.Machine))
	field("server", r.Server)

	switch {
	case r.Connection.Connected:
		since := ""
		if r.Connection.Since != nil {
			since = " " + ui.Dim("since "+r.Connection.Since.Format("15:04:05"))
		}
		field("connection", ui.Green("connected")+since)
	case r.Connection.Error != "":
		field("connection", ui.Red("not connected")+" "+ui.Dim(r.Connection.Error))
	case r.Service.State == "running":
		field("connection", ui.Yellow("not connected yet"))
	default:
		field("connection", ui.Yellow("not connected"))
	}

	switch {
	case !r.Service.Installed:
		field("service", ui.Yellow("not installed"))
	case r.Service.State == "running":
		field("service", ui.Green("running")+" "+ui.Dim(r.Service.Scope+" service, starts at boot"))
	default:
		field("service", ui.Yellow(r.Service.State)+" "+ui.Dim(r.Service.Scope+" service, starts at boot"))
	}
	if r.Service.Advice != "" {
		field("", ui.Yellow(r.Service.Advice))
	}

	switch {
	case r.Sessions == nil:
		field("sessions", ui.Red("unknown")+" "+ui.Dim(r.SessionErr))
	case *r.Sessions == 0:
		field("sessions", ui.Dim("none"))
	default:
		field("sessions", ui.Bold(fmt.Sprint(*r.Sessions))+" running")
	}

	// The client hides a dead line from everything above it, which is its purpose; this is where a
	// machine down to its last working path shows it.
	switch {
	case r.MultipathErr != "":
		field("multipath", ui.Red("not answering")+" "+ui.Dim(r.MultipathErr))
	case r.Multipath != nil:
		printClient(field, *r.Multipath)
	case r.Service.State == "running":
		field("multipath", ui.Yellow("no client running")+" "+ui.Dim("(the connection goes directly)"))
	}

	if r.Proxy != "" {
		field("proxy", r.Proxy)
	}
	if !r.Service.Installed {
		hint("`microteams start` to connect")
	}
}

// printClient renders the multipath client's session and every line.
func printClient(field func(label, value string), st client.Status) {
	switch {
	case st.Session == nil:
		field("multipath", ui.Yellow("no session yet"))
	case st.Session.State == "live":
		field("multipath", ui.Green("live")+" "+ui.Dim(fmt.Sprintf("session %s for %s, %d started",
			st.Session.ID, (time.Duration(st.Session.AgeMs)*time.Millisecond).Round(time.Second), st.SessionsStarted)))
	default:
		field("multipath", ui.Yellow(st.Session.State)+" "+ui.Dim(st.LastSessionEnd))
	}
	for _, l := range st.Lines {
		field("line "+l.ID, describe(l))
	}
}

// describe renders one line the way somebody asking "is this path working?" reads it. The reconnect
// count is part of the answer: a line can fail and come back many times without anything above it
// noticing.
func describe(l client.LineStatus) string {
	where := ui.Dim(l.URL)
	flapped := ""
	if l.Reconnects > 0 {
		flapped = ui.Dim(fmt.Sprintf("  (recovered %d×)", l.Reconnects))
	}
	switch l.State {
	case "up":
		return ui.Bold("up") + " " + where + ui.Dim(fmt.Sprintf("  last byte %d ms ago", l.LastByteAgoMs)) + flapped
	case "connecting":
		return ui.Yellow("connecting") + " " + where + flapped
	default:
		reason := l.LastReason
		if reason == "" {
			reason = "no reason given"
		}
		return ui.Red("down: "+reason) + " " + where + flapped
	}
}
