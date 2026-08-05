// Package lines gives this connector the same choice of network path the browser has: several
// public routes to one backend, ranked by what has actually been measured.
//
// The shape is dictated by what a connector is. Two different programs share this binary: a
// resident service that stays up for weeks, and short commands (`microteams api …`) that run for a
// few hundred milliseconds and exit. Measuring lines is worth it for the first and absurd for the
// second — a command that fetched a routing table before doing its work would add a round trip to
// every call, which for a latency feature would be a poor joke.
//
// So the service measures and publishes, and the commands read what it published. The registry is
// cached beside the config where `microteams status` already looks; a command with no cache falls
// back to one same-origin line, which is exactly what the connector did before MultiPath existed.
package lines

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	multipath "github.com/micro-teams/multipath/go"
)

// sameOrigin is the registry that means "however this machine was already reaching the server".
//
// Not an empty registry: with no lines at all the client has nowhere to send anything and every
// request fails. This entry resolves to whatever host the request already carried, so a connector
// with no cache behaves precisely as it did before.
var sameOrigin = multipath.Registry{
	Lines: []multipath.Line{{ID: "origin", URL: "", Transport: "same-origin", Weight: 100}},
}

// Path is where the registry is cached, beside the config file.
func Path(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), "lines.json")
}

// New builds the client for this process from whatever has been cached.
//
// Never fails: an unreadable or absent cache leaves the same-origin line, because a connector that
// refused to run because it could not read a routing table would have made the transport layer a
// prerequisite for reaching the network at all.
//
// apiBase is what the same-origin line means here. A browser has an origin and never needs to be
// told; a connector does, and without it the entry that says "wherever this machine already reaches
// the control plane" cannot be turned into a URL at all. Requests survived that, because they carry
// a host of their own for the transport to infer — the probe does not, so the origin line failed
// every probe, went down after three, and was ranked last on a fiction. Where a second line existed
// that looked like the right answer for the wrong reason; where it did not, the health table simply
// described a working line as dead.
//
// Only the origin of it is kept, because that is what a line is. Every other line in the registry is
// a bare origin and every path already carries the "/mt" prefix, so keeping the path here would
// produce "/mt/mt/probe" — which a test caught immediately, and which in production would have read
// as "this line answers 404" rather than as a mistake made here.
func New(cfgPath, apiBase string) *multipath.Client {
	return multipath.New(multipath.Options{Registry: cached(cfgPath), BaseURL: originOf(apiBase)})
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

// Refresh asks the control plane which lines exist and adopts the answer, caching it for the short
// commands that will not do this themselves.
//
// Best-effort: the endpoint is public and tiny, but a machine that cannot reach it right now is a
// machine that has bigger problems than routing, and it keeps whatever it had.
func Refresh(ctx context.Context, client *multipath.Client, apiBase, cfgPath string) error {
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
	client.SetRegistry(registry)
	if data, err := json.Marshal(registry); err == nil {
		_ = os.WriteFile(Path(cfgPath), data, 0o600)
	}
	return nil
}
