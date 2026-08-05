// The connector's half of multi-line, tested at the two places it can go quietly wrong: what a
// short command reads when nothing has been cached, and whether the cached document actually
// produces requests that race.
//
// Both failures are silent by nature. A connector that fell back to one line would keep working, so
// nothing would report it; a cache that round-tripped into something the client cannot use would
// leave every machine on a single path while the deployment believed otherwise.

package lines

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	multipath "github.com/micro-teams/multipath/go"
)

func cfgPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config.json")
}

func TestNoCacheMeansOneSameOriginLine(t *testing.T) {
	client := New(cfgPath(t), "https://control.example/mt")

	got := client.Lines()
	if len(got) != 1 || got[0].URL != "" {
		t.Fatalf("expected a single same-origin line, got %+v", got)
	}
}

// Not an empty registry: with no lines the client has nowhere to send anything and every request
// fails. "However you were already reaching the server" is the answer that keeps a fresh machine
// working exactly as it did before any of this existed.
func TestASameOriginLineStillSendsRequests(t *testing.T) {
	var reached atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := &http.Client{Transport: New(cfgPath(t), server.URL+"/mt").RoundTripper()}
	resp, err := client.Get(server.URL + "/mt/chat")
	if err != nil {
		t.Fatalf("a machine with no cache could not send a request: %v", err)
	}
	_ = resp.Body.Close()
	if reached.Load() != 1 {
		t.Errorf("the request never arrived: %d", reached.Load())
	}
}

func TestACorruptCacheIsIgnoredRatherThanFatal(t *testing.T) {
	path := cfgPath(t)
	if err := os.WriteFile(Path(path), []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := New(path, "https://control.example/mt").Lines()
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

	if got := New(path, "https://control.example/mt").Lines(); len(got) != 1 || got[0].ID != "origin" {
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
	client := New(path, control.URL+"/mt")
	if err := Refresh(context.Background(), client, control.URL+"/mt", path); err != nil {
		t.Fatalf("refresh failed: %v", err)
	}

	if ids := ids(client.Lines()); len(ids) != 2 || ids[1] != "direct" {
		t.Fatalf("the registry was not adopted: %v", ids)
	}

	// The half that matters for `microteams api`: the next process must find it without asking.
	next := New(path, control.URL+"/mt")
	if ids := ids(next.Lines()); len(ids) != 2 || ids[1] != "direct" {
		t.Fatalf("a later command did not see the cached registry: %v", ids)
	}
}

func TestRefreshKeepsWhatItHadWhenTheEndpointIsMissing(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer control.Close()

	path := cfgPath(t)
	client := New(path, control.URL+"/mt")
	if err := Refresh(context.Background(), client, control.URL+"/mt", path); err != nil {
		t.Errorf("a control plane without the endpoint is not an error here: %v", err)
	}
	if got := client.Lines(); len(got) != 1 || got[0].ID != "origin" {
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
	client := New(path, control.URL+"/mt")
	if err := Refresh(context.Background(), client, control.URL+"/mt", path); err == nil {
		t.Error("a malformed registry was accepted silently")
	}
	if got := client.Lines(); len(got) != 1 || got[0].ID != "origin" {
		t.Errorf("the working line was replaced by a bad one: %+v", got)
	}
	if _, err := os.Stat(Path(path)); err == nil {
		t.Error("a malformed registry was cached for the next command to read")
	}
}

// The end of the chain, and the reason the cache exists: a document written by the resident service
// makes a later command's reads race. Nothing else in these tests would notice if the cached shape
// were subtly wrong — the client would just quietly use one line.
func TestACachedRegistryMakesReadsRace(t *testing.T) {
	var slowAsked, fastAsked atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slowAsked.Add(1)
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
			return
		}
		_, _ = w.Write([]byte("slow"))
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fastAsked.Add(1)
		_, _ = w.Write([]byte("fast"))
	}))
	defer fast.Close()

	path := cfgPath(t)
	registry := multipath.Registry{Lines: []multipath.Line{
		{ID: "slow", URL: slow.URL, Weight: 100},
		{ID: "fast", URL: fast.URL, Weight: 90},
	}}
	writeCache(t, path, registry)

	client := multipath.New(multipath.Options{
		Registry:   cached(path),
		HedgeAfter: 50 * time.Millisecond,
	})
	response, err := client.Get(context.Background(), "/mt/chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	body := make([]byte, 4)
	_, _ = response.Body.Read(body)
	if string(body) != "fast" {
		t.Errorf("the slow line won: %q", body)
	}
	if fastAsked.Load() == 0 {
		t.Error("the second line was never asked, so nothing raced")
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

// The defect this file did not catch until production did: a connector has no origin of its own, so
// the same-origin entry cannot become a URL unless it is told what "same" means. Requests survived
// it — they carry a host the transport can infer from — but a probe does not, so the origin line
// failed every probe, went down after three, and the ranking was based on a fiction.
func TestTheSameOriginLineIsProbable(t *testing.T) {
	var probes atomic.Int32
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/mt/probe" {
			probes.Add(1)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer control.Close()

	client := New(cfgPath(t), control.URL+"/mt")
	client.Probe(context.Background(), "/mt/probe")

	if probes.Load() == 0 {
		t.Fatal("the same-origin line was never probed, so its health is a guess")
	}
	if health := client.Health().Get("origin"); !health.Measured || health.State != multipath.StateUp {
		t.Errorf("the origin line is not measured as up: %+v", health)
	}
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
