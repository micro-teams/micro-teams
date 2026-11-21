// What the state file has to get right: the control link as the service saw it, the MultiPath
// client's addresses, and nothing believed from a writer that is gone. The cases pinned are the
// ones where a wrong answer would still look like a confident one.
package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tempCfg(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config.json")
}

func TestLinkUpIsRecordedAndReadBack(t *testing.T) {
	cfg := tempCfg(t)
	at := time.Now().Truncate(time.Second)

	Write(cfg, 2, Client{}, Link{Up: true, Since: at}, Tmux{})

	link := CurrentLink(cfg)
	if !link.Up {
		t.Fatal("link should read as up")
	}
	if !link.Since.Equal(at) {
		t.Fatalf("since = %v, want %v", link.Since, at)
	}
}

// A process is running and it is not connected: the reason survives, so whoever looks is told why.
func TestLinkDownKeepsTheReason(t *testing.T) {
	cfg := tempCfg(t)

	Write(cfg, 0, Client{}, Link{Up: false, Error: "dial tcp 10.0.0.1:443: i/o timeout"}, Tmux{})

	link := CurrentLink(cfg)
	if link.Up {
		t.Fatal("link must not read as up")
	}
	if link.Error == "" {
		t.Fatal("the reason must be kept — it is the whole point")
	}
	if !link.Since.IsZero() {
		t.Fatal("a link that is down has no since")
	}
}

// "Not connected yet" is not a failure. A process that started half a second ago looks exactly like
// this, and reporting it as an error would be its own kind of lie.
func TestNotConnectedYetIsNotAnError(t *testing.T) {
	cfg := tempCfg(t)

	Write(cfg, 0, Client{}, Link{}, Tmux{})

	link := CurrentLink(cfg)
	if link.Up || link.Error != "" {
		t.Fatalf("want down with no reason, got %+v", link)
	}
}

// A file left behind by a host that is gone must not keep claiming a connection: the state file
// outlives the process, and "connected" from a dead writer is the same wrong answer in a new place.
func TestARecordedLinkFromADeadWriterIsNotBelieved(t *testing.T) {
	cfg := tempCfg(t)
	Write(cfg, 1, Client{PID: 7, Listen: "127.0.0.1:7000", Status: "127.0.0.1:7001"}, Link{Up: true, Since: time.Now()}, Tmux{})

	// Rewrite the snapshot with a pid that cannot be alive.
	data, err := os.ReadFile(Path(cfg))
	if err != nil {
		t.Fatal(err)
	}
	// pid 2^31-1 is not a running process on any machine this ships to.
	replaced := replacePID(t, string(data))
	if err := os.WriteFile(Path(cfg), []byte(replaced), 0o600); err != nil {
		t.Fatal(err)
	}

	if CurrentLink(cfg).Up {
		t.Fatal("a link recorded by a process that no longer exists must not read as up")
	}
	if c := CurrentClient(cfg); c.Listen != "" {
		t.Fatalf("a client recorded by a process that no longer exists must not be used: %+v", c)
	}
}

func TestMissingFileReadsAsNotConnected(t *testing.T) {
	if CurrentLink(tempCfg(t)).Up {
		t.Fatal("no file means no connection, not a connection")
	}
}

// The service's tmux is read back as it was written, and a writer that is gone has none.
func TestTheServicesTmuxIsRecordedAndReadBack(t *testing.T) {
	cfg := tempCfg(t)
	if got := CurrentTmux(cfg); got != (Tmux{}) {
		t.Fatalf("no file is no tmux: %+v", got)
	}
	want := Tmux{Bin: "/home/u/.config/microteams/bin/tmux", TempDir: "/tmp"}
	Write(cfg, 3, Client{}, Link{}, want)
	if got := CurrentTmux(cfg); got != want {
		t.Fatalf("tmux = %+v, want %+v", got, want)
	}
	data, err := os.ReadFile(Path(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(Path(cfg), []byte(replacePID(t, string(data))), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := CurrentTmux(cfg); got != (Tmux{}) {
		t.Fatalf("a tmux recorded by a process that no longer exists must not be used: %+v", got)
	}
}

// Apply gives this process the service's environment for tmux, unsetting what the service lacked.
func TestApplySetsTheServicesEnvironment(t *testing.T) {
	t.Setenv("CONNECTOR_TMUX", "")
	t.Setenv("TMPDIR", "/somewhere")
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")
	if err := (Tmux{Bin: "/b/tmux", TempDir: "/tmp"}).Apply(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("CONNECTOR_TMUX") != "/b/tmux" || os.TempDir() != "/tmp" {
		t.Fatalf("env = %q %q", os.Getenv("CONNECTOR_TMUX"), os.TempDir())
	}
	if _, set := os.LookupEnv("XDG_RUNTIME_DIR"); set {
		t.Fatal("XDG_RUNTIME_DIR must be unset when the service had none")
	}
}

func replacePID(t *testing.T, snapshot string) string {
	t.Helper()
	return replaceField(snapshot, `"pid":`, "2147483647")
}

func replaceField(snapshot, key, value string) string {
	start := indexOf(snapshot, key)
	if start < 0 {
		return snapshot
	}
	rest := snapshot[start+len(key):]
	end := 0
	for end < len(rest) && rest[end] != ',' && rest[end] != '}' {
		end++
	}
	return snapshot[:start+len(key)] + value + rest[end:]
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func TestTheClientIsRecordedAndReadBack(t *testing.T) {
	cfg := tempCfg(t)
	want := Client{PID: 42, Listen: "127.0.0.1:7000", Status: "127.0.0.1:7001"}
	Write(cfg, 0, want, Link{}, Tmux{})
	if got := CurrentClient(cfg); got != want {
		t.Fatalf("client = %+v, want %+v", got, want)
	}
}
