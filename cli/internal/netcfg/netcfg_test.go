// The proxy setting has one job that matters: reach a process the system started with an empty
// environment. So these check the parts that make that true — it is stored somewhere the connector
// library will not overwrite, and applying it actually changes what Go's own proxy resolution says.
package netcfg

import (
	"os"
	"path/filepath"
	"testing"
)

func tempCfg(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config.json")
}

func TestSavedProxyIsReadBack(t *testing.T) {
	cfg := tempCfg(t)
	if err := Save(cfg, Settings{Proxy: "http://proxy.example:3128", NoProxy: "localhost"}); err != nil {
		t.Fatal(err)
	}
	got := Load(cfg)
	if got.Proxy != "http://proxy.example:3128" || got.NoProxy != "localhost" {
		t.Fatalf("got %+v", got)
	}
}

// It must live beside config.json, not inside it: the connector library rewrites config.json from
// its own struct, so a key that struct does not know is dropped the next time anything saves —
// a setting that vanishes on your next login.
func TestItIsNotStoredInTheLibrarysConfigFile(t *testing.T) {
	cfg := tempCfg(t)
	if err := Save(cfg, Settings{Proxy: "http://proxy.example:3128"}); err != nil {
		t.Fatal(err)
	}
	if Path(cfg) == cfg {
		t.Fatal("the proxy must not be written into config.json")
	}
	if _, err := os.Stat(cfg); err == nil {
		t.Fatal("config.json must not have been created by saving a proxy")
	}
}

// A proxy URL routinely carries a password.
func TestTheFileIsNotWorldReadable(t *testing.T) {
	cfg := tempCfg(t)
	if err := Save(cfg, Settings{Proxy: "http://user:secret@proxy.example:3128"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(Path(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("mode = %o, want 600", mode)
	}
}

func TestMissingFileMeansNoOpinion(t *testing.T) {
	if got := Load(tempCfg(t)); got.Proxy != "" || got.NoProxy != "" {
		t.Fatalf("got %+v", got)
	}
}

// The point of the whole package: after Apply, Go's own proxy resolution — which is what the
// WebSocket dialer and every HTTP client here use — routes through the configured proxy.
func TestApplyMakesGosProxyResolutionUseIt(t *testing.T) {
	for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(key, "")
	}
	cfg := tempCfg(t)
	if err := Save(cfg, Settings{Proxy: "http://proxy.example:3128"}); err != nil {
		t.Fatal(err)
	}

	if !Apply(cfg) {
		t.Fatal("Apply should report that it set a proxy")
	}
	if got := os.Getenv("HTTPS_PROXY"); got != "http://proxy.example:3128" {
		t.Fatalf("HTTPS_PROXY = %q", got)
	}
}

func TestApplyDoesNothingWhenUnset(t *testing.T) {
	if Apply(tempCfg(t)) {
		t.Fatal("with nothing configured, Apply must not claim to have set anything")
	}
}

// Printed by `status` and pasted into chats when people ask for help.
func TestEffectiveHidesThePassword(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://user:secret@proxy.example:3128")
	got := Effective("https://example.invalid")
	if got == "" {
		t.Fatal("expected a proxy to be reported")
	}
	if contains(got, "secret") {
		t.Fatalf("the password leaked: %s", got)
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
