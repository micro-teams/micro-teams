// Where the control link goes, now that it does not choose.
//
// This file used to pin which of several routes was dialled and what happened to one that could not
// hold a connection. MultiPath 0.2.0 deleted the question: the link is a stream on ONE redundant
// transport carried over every line at once, so there is no route to pick and a bad route is simply
// never the one a byte arrives on. What is left worth pinning is what replaced it — that the link
// really is carried inside the substrate rather than beside it, that a changed registry is picked up
// without stopping the service, and that a line's state reaches the place `microteams status` reads.
//
// The first of those is tested end to end against a real origin in this process, because "the
// WebSocket went over the substrate" is exactly the kind of claim that a test with a stub would make
// convincingly and wrongly: the connector works either way until the day the direct route is the one
// that is blocked.

package host

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	multipath "github.com/micro-teams/multipath/go"

	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/microteams/cli/internal/lines"
	"github.com/micro-teams/microteams/cli/internal/state"
)

// origin runs the server end of the substrate in this process, splicing every normal stream to addr.
// It returns the http:// URL a line is dialled at.
func origin(t *testing.T, addr string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		_ = multipath.Serve(ln, multipath.ServerOptions{}, multipath.Services{lines.AppService: multipath.DialService(addr)})
	}()
	return "http://" + ln.Addr().String()
}

// The whole point of the change, proved rather than assumed: the control WebSocket's bytes travel
// inside the redundant transport.
//
// It is proved by giving the substrate somewhere to go that the WebSocket could not reach on its
// own — the control plane listens on loopback and is reachable only by being spliced to from the
// origin — so a connector that dialled the URL itself would fail. A test whose lines pointed at the
// same place the URL does would pass just as well with the substrate removed entirely.
func TestTheControlLinkIsCarriedInsideTheSubstrate(t *testing.T) {
	var upgraded atomic.Int32
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Counted on ARRIVAL, not after the upgrade completes. The client's dial returns the moment
		// it has read the 101, which can be before this handler has run its next statement — so
		// counting afterwards is a race the assertion loses on a loaded machine.
		upgraded.Add(1)
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, _, _ = conn.ReadMessage()
	}))
	defer control.Close()

	// Two lines to the SAME origin, which is what a line is: a different network path to one
	// process, never a different process. Every byte is written to both and the origin reassembles
	// one stream from whichever copies arrive first, so two origins would be two half-conversations.
	at := origin(t, control.Listener.Addr().String())
	host := &Host{mpLines: []multipath.Line{
		{ID: "a", URL: at, Transport: "tcp"},
		{ID: "b", URL: at, Transport: "tcp"},
	}}

	dialer := *websocket.DefaultDialer
	dialer.Proxy = nil
	dialer.NetDialContext = host.dialSubstrate

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := dialer.DialContext(ctx, "ws://control.invalid/mt/machine/link", nil)
	if err != nil {
		t.Fatalf("the control link could not be opened over the substrate: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if upgraded.Load() != 1 {
		t.Fatalf("the control plane saw %d handshakes", upgraded.Load())
	}

	// And every line's state reached the table `microteams status` reads. Not a detail: redundancy
	// hides line failure from everything above it, so this table is the only place a path that
	// quietly died is visible at all.
	//
	// Every line REPORTED, and at least one of them up — not all of them. Dialling returns as soon
	// as one link is up and the rest are still connecting, which is the right behaviour (waiting for
	// the slowest line before the first request would hand the slowest line the latency the whole
	// design exists to avoid). An assertion that all of them are up is therefore a race, and it is
	// one that passes on a quiet laptop and fails on a loaded CI runner — which is how this was
	// found.
	table := host.currentLines()
	if len(table) != 2 {
		t.Fatalf("expected both lines to be reported, got %+v", table)
	}
	carrying := 0
	for _, line := range table {
		if line.State == "up" {
			carrying++
		}
	}
	if carrying == 0 {
		t.Errorf("no line is carrying anything, yet a stream was served over it: %+v", table)
	}
}

// With no line there is nothing to dial, and that must arrive as a failed attempt rather than as a
// process that will not start: the reconnect loop above this is what turns "not yet" into "again in
// a moment", and a machine whose network comes up late still has to connect when it does.
func TestWithNoLinesTheDialFailsRatherThanPanics(t *testing.T) {
	host := &Host{}
	if _, err := host.dialSubstrate(context.Background(), "tcp", "ignored"); err == nil {
		t.Error("a host with no lines reported a connection")
	}
}

// The signal handler's job, minus the signal: re-read the registry and ask the transport for a fresh
// attempt. What matters is the last part — that it ASKS rather than stops, because stopping is what
// kills the screens this machine hosts.
type redialCounter struct {
	protocol.Transport
	redials atomic.Int32
}

func (r *redialCounter) Reconnect() { r.redials.Add(1) }

func TestRelinkAsksForANewAttemptRatherThanStopping(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/mt/lines" {
			_, _ = w.Write([]byte(`{"lines":[{"id":"origin","url":""},{"id":"cf","url":"https://cf.example","transport":"wss"}]}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer control.Close()

	host := &Host{cfgPath: t.TempDir() + "/config.json", apiBase: control.URL + "/mt"}
	transport := &redialCounter{}
	host.conn = transport

	host.relink(context.Background())

	if transport.redials.Load() != 1 {
		t.Errorf("expected exactly one re-dial, got %d", transport.redials.Load())
	}
	// And it adopted what it just fetched, rather than re-dialling the list it already had. A relink
	// that did not re-read the registry would look identical from the outside and be useless: adding
	// a line is the only reason anyone asks for one.
	if len(host.mpLines) != 2 {
		t.Errorf("the new registry was not adopted: %+v", host.mpLines)
	}
}

// A transport with nothing to re-dial — the one-shot HTTP one — must not be a crash.
func TestRelinkIsHarmlessOnATransportThatCannotRedial(t *testing.T) {
	host := &Host{cfgPath: t.TempDir() + "/config.json", apiBase: "http://127.0.0.1:1/mt"}
	host.conn = struct{ protocol.Transport }{}

	host.relink(context.Background())
}

// What `microteams status` reads has to survive the trip through the state file, because that file
// is the only channel between the resident service and every command that reports on it.
func TestTheLineTableIsWhatStatusReads(t *testing.T) {
	cfgPath := t.TempDir() + "/config.json"
	host := &Host{cfgPath: cfgPath}
	host.lastLines = []state.LineState{
		{ID: "origin", State: "up"},
		{ID: "cf", URL: "https://cf.example", State: "down", Reconnects: 2, Reason: "i/o timeout"},
	}
	host.writeState(0)

	got := state.CurrentLines(cfgPath)
	if len(got) != 2 {
		t.Fatalf("`microteams status` would report %+v", got)
	}
	if got[1].State != "down" || got[1].Reason != "i/o timeout" {
		t.Errorf("the dead line lost what made it worth reporting: %+v", got[1])
	}
}
