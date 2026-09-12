// Package lines tells this connector which network paths to the backend exist.
//
// It used to do more: rank them, measure them, and hand out the best one per request. MultiPath
// 0.2.0 removed the question. A client no longer picks a line — it brings up ONE redundant stream
// carried over every line at once, and the redundant layer writes each byte to all of them and
// delivers whichever copy arrives first. A dead line is simply never the fastest; there is no
// measurement to keep current, no ranking to get stale, and no switch to make. So what is left here
// is the list itself: fetch it, cache it, hand it over.
//
// The cache still matters for the same reason it always did. Two programs share this binary: a
// resident service that stays up for weeks and short commands that live a few hundred milliseconds.
// The service refreshes the registry and writes it beside the config; a command reads what was
// written rather than asking. A command with no cache falls back to one same-origin line, which is
// exactly what the connector did before MultiPath existed.
package lines

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	multipath "github.com/micro-teams/multipath/go"
)

// sameOrigin is the registry that means "however this machine was already reaching the server".
//
// Not an empty registry: with no lines at all the client has nowhere to send anything and every
// request fails. This entry resolves to whatever host the request already carried, so a connector
// with no cache behaves precisely as it did before.
var sameOrigin = multipath.Registry{
	Lines: []multipath.Line{{ID: "origin", URL: "", Transport: "wss", Weight: 100}},
}

// Path is where the registry is cached, beside the config file.
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "lines.json")
}

// For lists the lines this process should carry its stream over, from whatever has been cached.
//
// Never fails: an unreadable or absent cache leaves the same-origin line, because a connector that
// refused to run because it could not read a routing table would have made the transport layer a
// prerequisite for reaching the network at all.
//
// apiBase is what the same-origin line means here. A browser has an origin and never needs to be
// told; a connector does, and without it the entry that says "wherever this machine already reaches
// the control plane" cannot be turned into a URL at all — an empty URL is not something a link can
// be dialled over.
//
// Only the origin of it is kept, because that is what a line is: every other line in the registry is
// a bare origin, and the link path is joined to it by the transport.
func For(cfgPath, apiBase string) []multipath.Line {
	registry := cached(cfgPath)
	origin := originOf(apiBase)
	out := make([]multipath.Line, 0, len(registry.Lines))
	for _, line := range registry.Lines {
		if line.URL == "" {
			line.URL = origin
		}
		if line.URL == "" {
			continue // nothing to dial: not an error, just not a line
		}
		// A label this transport does not know is worse than no label: an unknown one is refused
		// outright, while an empty one lets the URL's scheme decide (https means TLS, http means
		// plaintext). Until 0.2.0 this field was free-form and nothing read it, so registries in the
		// wild carry "same-origin", "cloudflare", "direct" — words that were perfectly good then and
		// are undialable now. Dropping them costs a deployment its explicit choice of
		// encapsulation, which is recoverable; keeping them costs it every line, silently.
		switch line.Transport {
		case "", "ws", "wss", "tcp", "tls":
		default:
			line.Transport = ""
		}
		out = append(out, line)
	}
	return out
}

func originOf(apiBase string) string {
	parsed, err := url.Parse(apiBase)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return apiBase
	}
	return parsed.Scheme + "://" + parsed.Host
}

func cached(cfgPath string) multipath.Registry {
	data, err := os.ReadFile(Path(cfgPath))
	if err != nil {
		return sameOrigin
	}
	registry, err := multipath.ParseRegistry(data)
	if err != nil {
		return sameOrigin
	}
	return registry
}

// Refresh asks the control plane which lines exist and caches the answer, for this process's next
// dial and for the short commands that will not ask themselves.
//
// It does not hand the new list to a live stream. A redundant stream's links are fixed when it is
// dialled, so adopting a changed registry means dialling again — which is a decision about when to
// disturb a working connection, and belongs to whoever owns it, not here.
//
// Best-effort: the endpoint is public and tiny, but a machine that cannot reach it right now is a
// machine that has bigger problems than routing, and it keeps whatever it had.
func Refresh(ctx context.Context, apiBase, cfgPath string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/lines", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil // not deployed yet; the same-origin line is the right answer
	}

	var body json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	registry, err := multipath.ParseRegistry(body)
	if err != nil {
		// A registry that arrived and could not be read is a misconfiguration on the server, not a
		// reason to stop working — but it must not be silent, or the deployment believes multi-line
		// is on while every machine quietly uses one line. That exact silence hid a bug for weeks
		// on the browser side.
		return err
	}
	if data, err := json.Marshal(registry); err == nil {
		_ = os.WriteFile(Path(cfgPath), data, 0o600)
	}
	return nil
}

// Transport is the http.RoundTripper a short command sends over: one redundant stream to the origin
// carried across every cached line, brought up on the first request and torn down when the command
// exits.
//
// It would be cheaper to send an ordinary request to the origin and skip all this, and that was the
// first thing I proposed. It is wrong. The entire reason several lines exist is that the route to
// the origin may be the one that is blocked — so a short command that only ever uses that route
// fails precisely in the situation the feature was built for, while the resident service beside it
// carries on working. The cost of doing it properly is also smaller than it looks: a direct request
// pays a TLS handshake too, and the substrate's handshakes happen on every line at once, so the wait
// is the fastest line's rather than the configured one's.
//
// Dialled lazily so a command that makes no request pays nothing, and so a failure to reach any line
// arrives as a failed request rather than as a process that would not start.
func Transport(cfgPath, apiBase string) http.RoundTripper {
	return &transport{lines: For(cfgPath, apiBase)}
}

type transport struct {
	lines  []multipath.Line
	mu     sync.Mutex
	client *multipath.Client
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.mu.Lock()
	if t.client == nil {
		if len(t.lines) == 0 {
			t.mu.Unlock()
			return nil, errors.New("microteams: no line to send this over")
		}
		client, err := multipath.Dial(req.Context(), multipath.ClientOptions{Lines: t.lines})
		if err != nil {
			t.mu.Unlock()
			return nil, err
		}
		t.client = client
	}
	client := t.client
	t.mu.Unlock()
	return client.RoundTrip(req)
}
