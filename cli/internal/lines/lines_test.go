// The connector's half of multi-line, tested at the two places it can go quietly wrong: what a
// short command gets when nothing has been cached, and whether the cached document actually
// produces a transport that carries a request.
//
// Both failures are silent by nature. A connector that fell back to one line would keep working, so
// nothing would report it; a cache that round-tripped into something the transport cannot dial would
// leave every machine on a single path while the deployment believed otherwise.

package lines

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	multipath "github.com/micro-teams/multipath/go"
)

func cfgPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config.json")
}

func TestNoCacheMeansOneSameOriginLine(t *testing.T) {
	got := For(cfgPath(t), "https://control.example/mt")

	// Resolved, not left empty. A link is dialled at a URL, so "wherever this machine already
	// reaches the control plane" has to become that URL here or it is not a line at all — the
	// browser has an origin to fall back on and a connector has none.
	if len(got) != 1 || got[0].URL != "https://control.example" {
		t.Fatalf("expected a single resolved same-origin line, got %+v", got)
	}
	// And wss, not inferred from the scheme. Inference would give raw TLS on 443, which is a TLS
	// connection to a port answered by nginx — nginx speaks HTTP there, so the link would be
	// refused by every real deployment. Every deployment has a proxy in front, so the fallback has
	// to name the encapsulation that goes through one.
	if got[0].Transport != "wss" {
		t.Errorf("the fallback line must be dialled as a WebSocket through the proxy, got %q", got[0].Transport)
	}
}

// A label from before 0.2.0 must not cost a machine its lines.
//
// This field was free-form and unread until the substrate made it name the encapsulation, so caches
// and operator configs in the wild carry "same-origin", "cloudflare", "direct". An unknown label is
// refused outright and a line that cannot be dialled is simply one the client does not have — so the
// machine would fall back to nothing at all, with no error to show for it. Dropping the label leaves
// the URL's scheme to decide, which is recoverable; keeping it is not.
func TestALabelFromBeforeTheSubstrateIsDroppedRatherThanFatal(t *testing.T) {
	path := cfgPath(t)
	writeCache(t, path, multipath.Registry{Lines: []multipath.Line{
		{ID: "cf", URL: "https://cf.example", Transport: "cloudflare"},
	}})

	got := For(path, "https://control.example/mt")
	if len(got) != 1 {
		t.Fatalf("the line was thrown away entirely: %+v", got)
	}
	if got[0].Transport != "" {
		t.Errorf("an undialable label survived: %q", got[0].Transport)
	}
}

// startOrigin runs the server end of the substrate in this process, splicing every normal stream to
// addr, and returns the http:// URL its lines are dialled at.
func startOrigin(t *testing.T, addr string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		_ = multipath.Serve(ln, multipath.ServerOptions{}, multipath.Services{AppService: multipath.DialService(addr)})
	}()
	return "http://" + ln.Addr().String()
}

func TestACorruptCacheIsIgnoredRatherThanFatal(t *testing.T) {
	path := cfgPath(t)
	if err := os.WriteFile(Path(path), []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := For(path, "https://control.example/mt")
	if len(got) != 1 || got[0].ID != "origin" {
		t.Fatalf("expected the fallback, got %+v", got)
	}
}

// A registry whose url is malformed is rejected by the parser, and the same rule applies: a
// connector that refused to start because a cached file was wrong would have made this layer a
// prerequisite for reaching the network at all.
func TestAnInvalidCachedRegistryFallsBack(t *testing.T) {
	path := cfgPath(t)
	invalid := `{"lines":[{"id":"a","url":"https://x.example/with/path"}]}`
	if err := os.WriteFile(Path(path), []byte(invalid), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := For(path, "https://control.example/mt"); len(got) != 1 || got[0].ID != "origin" {
		t.Fatalf("expected the fallback, got %+v", got)
	}
}

func TestRefreshAdoptsTheRegistryAndCachesItForShortCommands(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mt/lines" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("content-type", "application/json")
		// Optional fields as null, which is what the backend actually serves for anything unset.
		_, _ = w.Write([]byte(`{"lines":[
			{"id":"origin","url":"","transport":null,"weight":null,"foreignOrigin":null},
			{"id":"direct","url":"https://direct.mt.example.app","transport":"direct","weight":90}
		]}`))
	}))
	defer control.Close()

	path := cfgPath(t)
	if err := Refresh(context.Background(), control.URL+"/mt", path); err != nil {
		t.Fatalf("refresh failed: %v", err)
	}

	// The half that matters for `microteams api`: the next process must find it without asking.
	if ids := ids(For(path, control.URL+"/mt")); len(ids) != 2 || ids[1] != "direct" {
		t.Fatalf("a later command did not see the cached registry: %v", ids)
	}
}

func TestRefreshKeepsWhatItHadWhenTheEndpointIsMissing(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer control.Close()

	path := cfgPath(t)
	if err := Refresh(context.Background(), control.URL+"/mt", path); err != nil {
		t.Errorf("a control plane without the endpoint is not an error here: %v", err)
	}
	if got := For(path, control.URL+"/mt"); len(got) != 1 || got[0].ID != "origin" {
		t.Errorf("expected to keep the same-origin line, got %+v", got)
	}
}

// A registry that arrived and could not be read is a server-side misconfiguration. It must be
// reported — the caller logs it — and it must not replace what already works.
func TestRefreshReportsAMalformedRegistry(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"lines":[{"id":"","url":""}]}`))
	}))
	defer control.Close()

	path := cfgPath(t)
	if err := Refresh(context.Background(), control.URL+"/mt", path); err == nil {
		t.Error("a malformed registry was accepted silently")
	}
	if got := For(path, control.URL+"/mt"); len(got) != 1 || got[0].ID != "origin" {
		t.Errorf("the working line was replaced by a bad one: %+v", got)
	}
	if _, err := os.Stat(Path(path)); err == nil {
		t.Error("a malformed registry was cached for the next command to read")
	}
}

// The end of the chain, and the reason the cache exists: a document written by the resident service
// is what a later command carries its stream over.
//
// It used to say "makes a later command's reads race", and the racing is gone — the redundant layer
// writes every byte to every line and takes whichever arrives first, so there is no per-request race
// to observe from here. What is left to pin is the part that still fails silently: a cached document
// that round-trips into something undialable would leave the command on one line, or on none, and
// nothing would say so.
func TestACachedRegistryIsWhatTheNextCommandCarries(t *testing.T) {
	var reached atomic.Int32
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached.Add(1)
		_, _ = w.Write([]byte("served"))
	}))
	defer app.Close()

	origin := startOrigin(t, app.Listener.Addr().String())
	path := cfgPath(t)
	writeCache(t, path, multipath.Registry{Lines: []multipath.Line{
		{ID: "a", URL: origin, Transport: "tcp"},
		{ID: "b", URL: origin, Transport: "tcp"},
	}})

	if got := For(path, ""); len(got) != 2 {
		t.Fatalf("the cached document did not come back as two lines: %+v", got)
	}

	client := &http.Client{Transport: Transport(path, "")}
	response, err := client.Get(origin + "/mt/chat")
	if err != nil {
		t.Fatalf("a command could not send over the cached lines: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(response.Body)
	if string(body) != "served" {
		t.Errorf("the answer did not come back intact: %q", body)
	}
	if reached.Load() != 1 {
		t.Errorf("the application saw %d requests, want exactly one", reached.Load())
	}
}

func writeCache(t *testing.T, cfg string, registry multipath.Registry) {
	t.Helper()
	data, err := json.Marshal(registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(Path(cfg), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func ids(lines []multipath.Line) []string {
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, line.ID)
	}
	return out
}

// And the specific way the base can be wrong: the API base carries a path, every line in the
// registry is a bare origin, and every request path already includes that prefix.
func TestOnlyTheOriginOfTheAPIBaseIsUsed(t *testing.T) {
	if got := originOf("https://microteams.app/mt"); got != "https://microteams.app" {
		t.Errorf("kept the path: %q", got)
	}
	if got := originOf("https://rucnet-119pve.mt.microteams.app:43267/mt"); got != "https://rucnet-119pve.mt.microteams.app:43267" {
		t.Errorf("lost the port or kept the path: %q", got)
	}
	// Nothing usable to parse: hand it back rather than inventing something.
	if got := originOf("not a url"); got != "not a url" {
		t.Errorf("mangled an unparseable base: %q", got)
	}
}
