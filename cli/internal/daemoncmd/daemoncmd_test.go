package daemoncmd

// The parts of the lifecycle commands that decide something without touching the machine: how an
// old command form becomes the new one, when a stop has to ask, and what status says.

import (
	"bytes"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/micro-teams/micro-connector/cli/brand"
	"github.com/micro-teams/microteams/cli/internal/mtbrand"
)

func TestCanonicalArgs(t *testing.T) {
	for _, tc := range []struct{ argv, old, new, want []string }{
		{[]string{"mt", "link", "connect", "http://s"}, []string{"link", "connect"}, []string{"start"}, []string{"mt", "start", "http://s"}},
		{[]string{"mt", "link", "--config", "c", "disconnect", "--force"}, []string{"link", "disconnect"}, []string{"stop"}, []string{"mt", "--config", "c", "stop", "--force"}},
		{[]string{"mt", "proxy", "set", "http://p"}, []string{"proxy"}, []string{"config", "proxy"}, []string{"mt", "config", "proxy", "set", "http://p"}},
		{[]string{"mt", "status"}, []string{"link", "connect"}, []string{"start"}, []string{"mt", "status"}},
	} {
		if got := canonicalArgs(tc.argv, tc.old, tc.new); !slices.Equal(got, tc.want) {
			t.Errorf("canonicalArgs(%v) = %v, want %v", tc.argv, got, tc.want)
		}
	}
}

// An alias runs the new command and accepts the old --force as --yes.
func TestAliasRunsNewCommandWithForce(t *testing.T) {
	var yes, ran bool
	c := &cobra.Command{Use: "stop", RunE: func(*cobra.Command, []string) error { ran = true; return nil }}
	yesFlag(c, &yes)
	root := &cobra.Command{Use: "microteams"}
	group := &cobra.Command{Use: "link", Hidden: true}
	group.AddCommand(alias(c, "link disconnect", "stop"))
	root.AddCommand(group)
	root.SetArgs([]string{"link", "disconnect", "--force"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if !ran || !yes || !c.Hidden || c.Name() != "disconnect" {
		t.Fatalf("ran=%v yes=%v hidden=%v name=%s", ran, yes, c.Hidden, c.Name())
	}
}

func TestMustAsk(t *testing.T) {
	for _, tc := range []struct {
		n    int
		err  error
		yes  bool
		want bool
	}{
		{0, nil, false, false},
		{2, nil, false, true},
		{2, nil, true, false},
		{0, errors.New("tmux busy"), false, true},
	} {
		if got := mustAsk(tc.n, tc.err, tc.yes); got != tc.want {
			t.Errorf("mustAsk(%d, %v, %v) = %v", tc.n, tc.err, tc.yes, got)
		}
	}
}

func TestStatusRendering(t *testing.T) {
	two := 2
	r := report{
		LoggedIn: true, Machine: "m1", Server: "https://s",
		Connection: connection{Connected: true},
		Service:    svc{Installed: true, Scope: "system", State: "running", Advice: "rewrite me"},
		Sessions:   &two,
	}
	var out bytes.Buffer
	render(&out, r)
	for _, want := range []string{"logged in", "connected", "running", "system service", "rewrite me", "2 running"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("status lacks %q:\n%s", want, out.String())
		}
	}
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	_ = json.Unmarshal(data, &back)
	if back["sessions"] != float64(2) || back["service"].(map[string]any)["advice"] != "rewrite me" {
		t.Errorf("json = %s", data)
	}
}

func TestStatusLoggedOut(t *testing.T) {
	var out bytes.Buffer
	render(&out, report{})
	if !strings.Contains(out.String(), "not logged in") || !strings.Contains(out.String(), "microteams login") {
		t.Errorf("status = %s", out.String())
	}
}

// Without sudo the config is this user's own.
func TestDefaultConfigWithoutSudo(t *testing.T) {
	mtbrand.Use()
	t.Setenv("SUDO_USER", "")
	if got := defaultConfig(); !strings.HasSuffix(got, brand.Current.ConfigDir+"/config.json") {
		t.Errorf("defaultConfig() = %s", got)
	}
}
