package daemoncmd

// The parts of the lifecycle commands that decide something without touching the machine: the
// sudo line a person is shown, and what status says.

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/micro-teams/microteams/cli/internal/mtbrand"
)

// The line shown for an elevated run is the one run, and pastes as it is: this binary by its
// absolute path with symlinks resolved (sudo's secure_path does not hold ~/.local/bin), every word
// that a shell would split or expand quoted.
func TestSudoSelfNamesThisBinaryByItsResolvedPath(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if self, err = filepath.EvalSymlinks(self); err != nil {
		t.Fatal(err)
	}
	cmd, line, err := sudoSelf("restart", "--config", "/home/a b/c.json")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(self) || !slices.Equal(cmd.Args, []string{"sudo", self, "restart", "--config", "/home/a b/c.json"}) {
		t.Fatalf("args = %v", cmd.Args)
	}
	if want := "sudo " + shellQuote(self) + " restart --config '/home/a b/c.json'"; line != want {
		t.Fatalf("line = %q, want %q", line, want)
	}
	if got := shellQuote("it's"); got != `'it'\''s'` {
		t.Fatalf("shellQuote = %s", got)
	}
}

func TestStatusRendering(t *testing.T) {
	two := 2
	r := report{
		LoggedIn: true, Machine: "m1", Server: "https://s",
		Connection: connection{Connected: true},
		Service:    svc{Installed: true, Scope: "system", State: "running"},
		Sessions:   &two,
	}
	var out bytes.Buffer
	render(&out, r)
	for _, want := range []string{"logged in", "connected", "running", "system service", "2 running"} {
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
	if back["sessions"] != float64(2) || back["service"].(map[string]any)["scope"] != "system" {
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

// A process that is not root acts as itself, whatever SUDO_USER says.
func TestNotUnderSudo(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("runs as root")
	}
	t.Setenv("SUDO_USER", "someone")
	home := os.Getenv("HOME")
	if sudoUser() != "" {
		t.Fatal("a process that is not root is not acting through sudo")
	}
	if err := AsInvokingUser(); err != nil || os.Getenv("HOME") != home {
		t.Fatalf("AsInvokingUser changed this process: %v, HOME=%s", err, os.Getenv("HOME"))
	}
}

// No config is an empty one; a config that cannot be read is an error, never something to replace.
func TestLoadConfig(t *testing.T) {
	mtbrand.Use()
	dir := t.TempDir()
	cfg, err := loadConfig(filepath.Join(dir, "none.json"))
	if err != nil || cfg.Token != "" {
		t.Fatalf("missing config = %+v, %v", cfg, err)
	}
	broken := filepath.Join(dir, "config.json")
	if err := os.WriteFile(broken, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(broken); err == nil {
		t.Fatal("a config that does not parse must be an error")
	}
}
