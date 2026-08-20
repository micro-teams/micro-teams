// Package netcfg holds this machine's own idea of how to reach the network — today, its proxy.
//
// The problem it solves is not that the code lacked proxy support. Every outbound path already
// honours the standard Go convention: the control-link WebSocket dials through
// websocket.DefaultDialer (whose Proxy is http.ProxyFromEnvironment), and the API client and the
// line prober both go through http.DefaultTransport (likewise). Run the connector by hand in a
// shell with a proxy exported and it uses it.
//
// What fails is the DELIVERY of that environment to a service. Debian's `service` execs its scripts
// through `env -i`, wiping everything; a systemd unit inherits nobody's shell. So a machine with a
// perfectly good global proxy has a connector process that has never heard of it, and the symptom
// is the confusing one: it may connect (same-origin) while the line registry times out, so the
// machine works and is permanently on one route.
//
// The fix is to stop depending on ambient environment for something we need. The proxy is written
// here, in a file this product owns, and applied by the process to itself at startup. Whether the
// machine is a container, whether an init system scrubs the environment, who ran it — none of it
// matters any more, because nothing has to be handed to us.
//
// It lives in its own file rather than in config.json for a specific reason: config.json is owned by
// the connector library, which rewrites it from a struct, so any key that struct does not know
// about is silently dropped the next time anything saves it (a login, for instance). A setting that
// disappears when you log in would be worse than no setting.
package netcfg

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

// Settings is what this machine knows about reaching the outside world.
type Settings struct {
	// Proxy is an http:// or socks5:// URL, used for both http and https. Empty means "no opinion",
	// and the environment (if there is one) is then left to speak for itself.
	Proxy string `json:"proxy,omitempty"`
	// NoProxy is the standard comma-separated exception list. Empty leaves any existing NO_PROXY
	// alone.
	NoProxy string `json:"noProxy,omitempty"`
}

// Path is where the settings live: beside the config, like the state file and the log.
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "network.json")
}

// Load reads the settings. A missing or unreadable file is not an error — it means "no opinion".
func Load(cfgPath string) Settings {
	if cfgPath == "" {
		return Settings{}
	}
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return Settings{}
	}
	var s Settings
	if json.Unmarshal(data, &s) != nil {
		return Settings{}
	}
	return s
}

// Save writes the settings, creating the directory if needed. 0600 because a proxy URL routinely
// carries a password.
func Save(cfgPath string, s Settings) error {
	if err := os.MkdirAll(filepath.Dir(Path(cfgPath)), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(Path(cfgPath), data, 0o600)
}

// Apply makes this process use the configured proxy, and reports whether it set one.
//
// It works by exporting the standard variables into our OWN environment rather than by handing a
// dialer to each caller — which looks indirect until you notice that the WebSocket dial happens
// inside the connector library, where this repo cannot reach to pass anything. Setting the
// environment covers every path at once, including the ones we do not own, and it is honest about
// what it is: the same mechanism Go already uses, with the delivery problem removed.
//
// MUST be called before anything makes a request. http.ProxyFromEnvironment reads the environment
// once and remembers it, so a later change would be ignored.
//
// A configured proxy overrides an inherited one on purpose: if this machine has been told which
// proxy to use, that instruction should win over whatever a shell happened to export.
func Apply(cfgPath string) bool {
	s := Load(cfgPath)
	if s.Proxy == "" {
		return false
	}
	for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
		_ = os.Setenv(key, s.Proxy)
	}
	if s.NoProxy != "" {
		for _, key := range []string{"NO_PROXY", "no_proxy"} {
			_ = os.Setenv(key, s.NoProxy)
		}
	}
	return true
}

// Effective reports the proxy this process would actually use for a URL, whatever the reason —
// configured here, or inherited from the environment. `status` shows it, because "am I going
// through a proxy" is otherwise unanswerable from outside the process.
func Effective(target string) string {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return ""
	}
	proxyURL, err := http.ProxyFromEnvironment(req)
	if err != nil || proxyURL == nil {
		return ""
	}
	return proxyURL.Redacted()
}
