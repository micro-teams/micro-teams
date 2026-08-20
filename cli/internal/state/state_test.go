// What the state file has to get right about the control link.
//
// The bug these exist for was not a crash: `link connect` said "Connected." and `status` said
// connected on a machine that had never reached the control plane, because both were reporting that
// the service manager had started a process. So the cases worth pinning are the ones where a wrong
// answer still looks like a confident answer.
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

	Write(cfg, 2, Line{ID: "eu", URL: "https://eu.example"}, Link{Up: true, Since: at})

	link := CurrentLink(cfg)
	if !link.Up {
		t.Fatal("link should read as up")
	}
	if !link.Since.Equal(at) {
		t.Fatalf("since = %v, want %v", link.Since, at)
	}
}

// The case that used to lie: a process is running, and it is NOT connected. The reason must survive
// so whoever looks gets told why instead of being told everything is fine.
func TestLinkDownKeepsTheReason(t *testing.T) {
	cfg := tempCfg(t)

	Write(cfg, 0, Line{}, Link{Up: false, Error: "dial tcp 10.0.0.1:443: i/o timeout"})

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

	Write(cfg, 0, Line{}, Link{})

	link := CurrentLink(cfg)
	if link.Up || link.Error != "" {
		t.Fatalf("want down with no reason, got %+v", link)
	}
}

// A file left behind by a host that is gone must not keep claiming a connection: the state file
// outlives the process, and "connected" from a dead writer is the same wrong answer in a new place.
func TestARecordedLinkFromADeadWriterIsNotBelieved(t *testing.T) {
	cfg := tempCfg(t)
	Write(cfg, 1, Line{ID: "eu"}, Link{Up: true, Since: time.Now()})

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
}

func TestMissingFileReadsAsNotConnected(t *testing.T) {
	if CurrentLink(tempCfg(t)).Up {
		t.Fatal("no file means no connection, not a connection")
	}
}

// An older host writes a snapshot with no link fields at all. It must read as "not connected" and
// not as an error — we genuinely do not know, and saying so is the honest answer.
func TestAnOlderHostReadsAsUnknownRatherThanBroken(t *testing.T) {
	cfg := tempCfg(t)
	old := `{"screens":3,"pid":` + itoa(os.Getpid()) + `,"lineId":"eu"}`
	if err := os.WriteFile(Path(cfg), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}

	link := CurrentLink(cfg)
	if link.Up || link.Error != "" {
		t.Fatalf("want unknown, got %+v", link)
	}
	if got := Screens(cfg); got != 3 {
		t.Fatalf("the rest of the file must still be read: screens = %d", got)
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

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
