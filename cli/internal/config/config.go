// Package config is the single on-disk identity of this installation: where the
// server is and the long-lived credential that represents this machine to it.
// Both the long-running host (`microteams run`) and the ad-hoc API caller (`microteams
// api`) read the same file, so a machine is configured once and both halves
// agree. The file carries no notion of what the server is for.
package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Config is the whole persisted state. Base is the server's origin; Token is the
// durable credential minted for this device by `microteams auth login`. WS is an
// optional explicit control-channel URL — when empty it is derived from Base.
type Config struct {
	Base     string `json:"base"`
	Token    string `json:"token"`
	MachineID string `json:"machine_id,omitempty"`
	WS       string `json:"ws,omitempty"`
}

// DefaultPath is where the config lives unless overridden (~/.config/microteams/config.json).
func DefaultPath() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "microteams", "config.json")
}

// Dir is the directory containing the default config.
func Dir() string { return filepath.Dir(DefaultPath()) }

// Load reads and parses the config at path.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("config: parse %s: %w", path, err)
	}
	return &c, nil
}

// Save writes the config to path, creating its directory (private perms).
func Save(path string, c *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("config: mkdir: %w", err)
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// APIBase is the origin the request/response API and the OpenAPI spec live under.
func (c *Config) APIBase() string { return strings.TrimRight(c.Base, "/") }

// SpecURL is the standard location of the server's OpenAPI document.
func (c *Config) SpecURL() string { return c.APIBase() + "/openapi.json" }

// ControlURL is the persistent control-channel URL the host dials out to. It is
// the explicit WS field when set, else Base with an ws(s) scheme and the
// conventional /agent path.
func (c *Config) ControlURL() (string, error) {
	if c.WS != "" {
		return c.WS, nil
	}
	u, err := url.Parse(c.Base)
	if err != nil {
		return "", fmt.Errorf("config: bad base %q: %w", c.Base, err)
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http", "":
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/machine/link"
	return u.String(), nil
}
