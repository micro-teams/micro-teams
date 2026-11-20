// Package netcfg holds this machine's own idea of how to reach the network: its proxy.
//
// Every outbound path honours the standard environment variables: the direct control link through
// websocket.DefaultDialer, direct API calls through http.DefaultTransport, and the MultiPath client,
// which inherits the service's environment, for its lines and line list. What a service lacks is the
// environment itself: Debian's `service` runs its scripts through `env -i`, and a systemd unit
// inherits nobody's shell. So the proxy is written here, in a file this product owns, and the
// process applies it to itself at startup, whoever started it.
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

// Apply makes this process, and every process it starts, use the configured proxy, and reports
// whether it set one. It exports the standard variables into this process's environment, because
// the WebSocket dial happens inside the connector library and the MultiPath client is another
// process: the environment is the one thing that reaches both.
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
