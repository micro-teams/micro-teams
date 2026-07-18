// Package apiauth resolves how this machine authenticates to the microteams backend and hands out
// an http transport that applies it. There are two callers: the CLI applet's `microteams.http`
// binding (business calls) and the applet fetch. The rule is the whole "an agent is an ordinary
// user" idea in one place:
//
//   - inside a screen (MICROTEAMS_SCREEN set) the request is exchanged, once and cached, for the
//     screen's agent user token via POST /agent/token, and that JWT is sent as `Authorization:
//     Bearer` — so the agent hits the same guarded endpoints a human does, as its own user;
//   - otherwise this machine's durable token (MICROTEAMS_TOKEN or `microteams auth login`) is sent
//     directly.
//
// Env overrides: MICROTEAMS_API (base URL), MICROTEAMS_TOKEN (credential), MICROTEAMS_SCREEN
// (per-screen token, set by the host inside every screen it opens).
package apiauth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/micro-teams/microteams/cli/internal/config"
)

// APIBase returns the server base URL: MICROTEAMS_API if set, else this machine's configured base,
// else a localhost default.
func APIBase() string {
	if base := os.Getenv("MICROTEAMS_API"); base != "" {
		return strings.TrimRight(base, "/")
	}
	if cfg, err := config.Load(config.DefaultPath()); err == nil && cfg.Base != "" {
		return cfg.APIBase()
	}
	return "http://localhost:8080"
}

// resolveToken returns this machine's credential: MICROTEAMS_TOKEN if set, else the stored one.
func resolveToken() string {
	if tok := os.Getenv("MICROTEAMS_TOKEN"); tok != "" {
		return tok
	}
	if cfg, err := config.Load(config.DefaultPath()); err == nil {
		return cfg.Token
	}
	return ""
}

// Transport returns an http.RoundTripper that authenticates every request bound for the API host.
func Transport() http.RoundTripper {
	base := APIBase()
	host := ""
	if u, err := url.Parse(base); err == nil {
		host = u.Host
	}
	return &bearerInjector{
		base:    http.DefaultTransport,
		host:    host,
		apiBase: base,
		token:   resolveToken(),
		screen:  os.Getenv("MICROTEAMS_SCREEN"),
	}
}

// Client returns an http.Client that applies Transport() with a sane timeout.
func Client() *http.Client {
	return &http.Client{Transport: Transport(), Timeout: 30 * time.Second}
}

type bearerInjector struct {
	base    http.RoundTripper
	host    string
	apiBase string // server base, for the /agent/token exchange
	token   string // this machine's durable token
	screen  string // per-screen token; non-empty only inside a screen (agent context)

	mu       sync.Mutex
	agentJWT string
	agentExp time.Time
}

func (b *bearerInjector) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host == b.host && req.Header.Get("Authorization") == "" {
		if b.screen != "" {
			if jwt := b.agentToken(); jwt != "" {
				req = req.Clone(req.Context())
				req.Header.Set("Authorization", "Bearer "+jwt)
			}
		} else if b.token != "" {
			req = req.Clone(req.Context())
			req.Header.Set("Authorization", "Bearer "+b.token)
		}
	}
	return b.base.RoundTrip(req)
}

// agentToken returns the screen's agent user token, exchanging the machine + screen tokens for a
// fresh one (POST /agent/token) when the cache is empty or near expiry. Returns "" on failure — the
// call then goes out unauthenticated and the server answers 401, surfacing as a normal API error.
func (b *bearerInjector) agentToken() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.agentJWT != "" && time.Now().Before(b.agentExp.Add(-30*time.Second)) {
		return b.agentJWT
	}
	req, err := http.NewRequest(http.MethodPost, b.apiBase+"/agent/token", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("X-Microteams-Session", b.token)
	req.Header.Set("X-Microteams-Screen", b.screen)
	// Go through the underlying transport, not this injector, so the exchange cannot recurse.
	resp, err := b.base.RoundTrip(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var out struct {
		Token     string `json:"token"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if json.NewDecoder(resp.Body).Decode(&out) != nil || out.Token == "" {
		return ""
	}
	b.agentJWT = out.Token
	b.agentExp = time.Unix(out.ExpiresAt, 0)
	return b.agentJWT
}
