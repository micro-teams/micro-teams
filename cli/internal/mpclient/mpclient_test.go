// The supervisor against the real thing: the multipath-client binary built from the pinned module,
// a MultiPath server in this process, and a plain HTTP target behind it. A request sent through
// Transport must reach the target, the client must keep the line list in its cache file and name
// its quickest line once it has measured it, a client that dies must be started again, and Fetch
// must refuse a download that does not run. quickest picks the answering line with the smallest
// round trip.
package mpclient

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/micro-teams/micro-connector/cli/update"
	"github.com/micro-teams/multipath/go/client"
	"github.com/micro-teams/multipath/go/protocol"
	"github.com/micro-teams/multipath/go/server"

	"github.com/micro-teams/microteams/cli/internal/state"
)

// buildClient builds multipath-client from the module go.mod pins.
func buildClient(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), Name)
	out, err := exec.Command("go", "build", "-o", bin, "github.com/micro-teams/multipath/go/cmd/multipath-client").CombinedOutput()
	if err != nil {
		t.Fatalf("go build multipath-client: %v\n%s", err, out)
	}
	return bin
}

// deployment is a MultiPath server whose one line is itself, splicing to target.
func deployment(t *testing.T, target string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://" + ln.Addr().String()
	lines := filepath.Join(t.TempDir(), "lines.json")
	if err := os.WriteFile(lines, []byte(`{"lines":[{"id":"only","url":"`+origin+`"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	srv, err := server.New(server.Config{LinkPath: "/multipath/v3/link", LinesPath: "/multipath/v3/lines",
		LinesFile: lines, Target: target, Limits: protocol.DefaultLimits(), Logf: t.Logf})
	if err != nil {
		t.Fatal(err)
	}
	hs := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: protocol.HandshakeTimeout}
	go func() { _ = hs.Serve(ln) }()
	t.Cleanup(func() { srv.Shutdown(); _ = hs.Close() })
	return origin
}

type logBuf struct {
	mu  sync.Mutex
	out strings.Builder
}

func (l *logBuf) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(&l.out, format+"\n", args...)
}

func (l *logBuf) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.out.String()
}

func live(t *testing.T, s *Supervisor, notPID int) state.Client {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := s.Live(); ok && s.Info().PID != notPID {
			return s.Info()
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no live session within 20 s: %s", s.Why())
	return state.Client{}
}

func TestRequestsGoThroughASupervisedClientThatIsStartedAgainWhenItDies(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%s %s host=%s", r.Method, r.URL.Path, r.Host)
	}))
	defer target.Close()
	origin := deployment(t, strings.TrimPrefix(target.URL, "http://"))

	var log logBuf
	cache := LinesCachePath(t.TempDir())
	s := NewSupervisor(Config{Binary: buildClient(t), LinesCache: cache, Base: origin + "/mt", Logf: log.logf})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	first := live(t, s, 0)

	addr, err := Lookup(first)
	if err != nil {
		t.Fatalf("Lookup of a live client: %v", err)
	}
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		if l, ok := s.Quickest(); ok {
			if l.URL != origin {
				t.Fatalf("the quickest line is %+v, want the deployment's only line %s", l, origin)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the client never measured its line")
		}
	}
	c := &http.Client{Transport: Transport(addr), Timeout: 10 * time.Second}
	resp, err := c.Get("https://api.example/mt/ping")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "GET /mt/ping host=api.example" {
		t.Fatalf("the target saw %q", body)
	}
	kept, err := os.ReadFile(cache)
	if err != nil || !strings.Contains(string(kept), `"entry":"`+origin+`"`) {
		t.Fatalf("the client keeps no line list of %s in %s: %q, %v", origin, cache, kept, err)
	}

	if err := syscall.Kill(first.PID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	second := live(t, s, first.PID)
	if second.Listen == first.Listen {
		t.Errorf("the new client reuses the old port %s", first.Listen)
	}
	if !strings.Contains(log.String(), "starting it again") {
		t.Errorf("a client that died was not said to be started again; log:\n%s", log.String())
	}

	s.Stop()
	if _, err := Lookup(second); err == nil {
		t.Error("a stopped client still answers")
	}
}

func TestLookupSaysWhyThereIsNoClient(t *testing.T) {
	if _, err := Lookup(state.Client{}); err == nil || !strings.Contains(err.Error(), "no multipath client") {
		t.Fatalf("Lookup of nothing = %v", err)
	}
	if _, err := Lookup(state.Client{PID: 1, Listen: "127.0.0.1:1", Status: "127.0.0.1:1"}); err == nil {
		t.Fatal("Lookup of a client that does not answer succeeded")
	}
}

func TestFetchInstallsARunnableClientAndRefusesAnythingElse(t *testing.T) {
	dir, err := update.PlatformDir()
	if err != nil {
		t.Skip(err)
	}
	bin := buildClient(t)
	serve := map[string]string{"good": bin}
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/connector/latest/"+dir+"/"+Name {
			http.NotFound(w, r)
			return
		}
		if f, ok := serve["good"]; ok {
			http.ServeFile(w, r, f)
			return
		}
		fmt.Fprint(w, "<html>not a binary</html>")
	}))
	defer files.Close()

	dest := filepath.Join(t.TempDir(), "bin", Name)
	if err := Install(context.Background(), files.URL+"/mt", dest); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if out, err := exec.Command(dest, "-h").CombinedOutput(); err != nil {
		t.Fatalf("the installed client does not run: %v\n%s", err, out)
	}

	delete(serve, "good")
	if _, err := Fetch(context.Background(), files.URL+"/mt", dest); err == nil {
		t.Fatal("Fetch accepted a page that is not a binary")
	}
	left, _ := filepath.Glob(filepath.Join(filepath.Dir(dest), ".*"))
	if len(left) != 0 {
		t.Errorf("a refused download left files behind: %v", left)
	}
}

func TestQuickestIsTheAnsweringLineWithTheSmallestRoundTrip(t *testing.T) {
	st := client.Status{Lines: []client.LineStatus{
		{ID: "origin", State: "up", RTTMs: 900},
		{ID: "late", State: "up", Soft: true, RTTMs: 40},
		{ID: "gone", State: "down", RTTMs: 30},
		{ID: "unmeasured", State: "up"},
		{ID: "direct", State: "up", RTTMs: 120},
	}}
	if l, ok := quickest(st); !ok || l.ID != "direct" {
		t.Fatalf("quickest is %+v, %v; want direct", l, ok)
	}
	if _, ok := quickest(client.Status{Lines: []client.LineStatus{{ID: "unmeasured", State: "up"}}}); ok {
		t.Fatal("a line without a round trip was taken as measured")
	}
}
