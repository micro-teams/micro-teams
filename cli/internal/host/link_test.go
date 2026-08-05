// Which line the control link dials, and what happens to a line that cannot hold it.
//
// This is the half that ops could not diagnose from the outside: a machine whose control link keeps
// dropping looks the same whether the route is bad or the server is restarting, and until now the
// connector reconnected to the same route either way. The three things worth pinning are that a
// line is actually chosen, that a route which drops the connection immediately stops being chosen,
// and that a route which worked for a while keeps its place.

package host

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	multipath "github.com/micro-teams/multipath/go"

	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/microteams/cli/internal/lines"
	"github.com/micro-teams/microteams/cli/internal/state"
)

func hostWithLines(t *testing.T, lines ...multipath.Line) *Host {
	t.Helper()
	client := multipath.New(multipath.Options{Registry: multipath.Registry{Lines: lines}})
	return &Host{
		lines:     client,
		linkLines: multipath.NewStreamSelector(client.Ranked, 5*time.Second, time.Minute, nil),
	}
}

const configured = "wss://microteams.example/mt/machine/link"

func TestTheLinkDialsTheBestLine(t *testing.T) {
	host := hostWithLines(t,
		multipath.Line{ID: "cf", URL: "https://cf.mt.example", Weight: 100},
		multipath.Line{ID: "direct", URL: "https://direct.mt.example", Weight: 90},
	)

	got := host.chooseLink(configured)

	if got != "wss://cf.mt.example/mt/machine/link" {
		t.Errorf("dialled %q", got)
	}
	// And it says so where `microteams status` will find it.
	if line := host.currentLine(); line.ID != "cf" {
		t.Errorf("status would report %+v", line)
	}
}

// The same-origin line means "wherever this machine already reaches the control plane", which is a
// fact this process has and the registry does not — so the configured URL is the answer, unchanged.
func TestTheSameOriginLineDialsTheConfiguredURL(t *testing.T) {
	host := hostWithLines(t, multipath.Line{ID: "origin", URL: "", Weight: 100})

	if got := host.chooseLink(configured); got != configured {
		t.Errorf("dialled %q, expected the configured URL untouched", got)
	}
	if line := host.currentLine(); line.ID != "origin" || line.URL != configured {
		t.Errorf("status would report %+v", line)
	}
}

// A machine with no registry at all still has to connect.
func TestWithNoLinesTheLinkStillDials(t *testing.T) {
	host := hostWithLines(t)

	if got := host.chooseLink(configured); got != configured {
		t.Errorf("dialled %q", got)
	}
}

// The case ops hit: a route that accepts the handshake and drops it. Measured as "did it connect"
// it looks like a success every time, and the connector reconnects to it forever.
func TestALineThatCannotHoldTheLinkIsSkipped(t *testing.T) {
	host := hostWithLines(t,
		multipath.Line{ID: "cf", URL: "https://cf.mt.example", Weight: 100},
		multipath.Line{ID: "direct", URL: "https://direct.mt.example", Weight: 90},
	)

	first := host.chooseLink(configured)
	host.reportLink(first, 900*time.Millisecond, nil) // dropped well before it was stable

	if got := host.chooseLink(configured); got != "wss://direct.mt.example/mt/machine/link" {
		t.Errorf("kept dialling a line that could not hold the connection: %q", got)
	}
}

// And the converse, or a machine would work its way through every line for no reason: a connection
// that lasted and then dropped is an ordinary disconnection — a server restart, a network blip —
// and says nothing bad about the route.
func TestAnOrdinaryDisconnectionCostsTheLineNothing(t *testing.T) {
	host := hostWithLines(t,
		multipath.Line{ID: "cf", URL: "https://cf.mt.example", Weight: 100},
		multipath.Line{ID: "direct", URL: "https://direct.mt.example", Weight: 90},
	)

	first := host.chooseLink(configured)
	host.reportLink(first, 2*time.Hour, nil)

	if got := host.chooseLink(configured); got != first {
		t.Errorf("moved off a line that had been working: %q", got)
	}
}

func TestTheRecordedLineIsWhatStatusReads(t *testing.T) {
	dir := t.TempDir()
	cfgPath := dir + "/config.json"

	host := hostWithLines(t, multipath.Line{ID: "direct", URL: "https://direct.mt.example"})
	host.cfgPath = cfgPath
	host.chooseLink(configured)

	if got := state.CurrentLine(cfgPath); got.ID != "direct" {
		t.Errorf("`microteams status` would report %+v", got)
	}
}

// The signal handler's job, minus the signal: re-read the registry, measure, and ask the transport
// for a fresh attempt. What matters is the last part — that it asks rather than stops, because
// stopping is what kills the screens this machine hosts.
type redialCounter struct {
	protocol.Transport
	redials atomic.Int32
}

func (r *redialCounter) Reconnect() { r.redials.Add(1) }

func TestRemeasureAsksForANewAttemptRatherThanStopping(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mt/lines":
			_, _ = w.Write([]byte(`{"lines":[{"id":"origin","url":""}]}`))
		case "/mt/probe":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer control.Close()

	dir := t.TempDir()
	host := hostWithLines(t, multipath.Line{ID: "origin", URL: ""})
	host.cfgPath = dir + "/config.json"
	host.apiBase = control.URL + "/mt"
	host.lines = lines.New(host.cfgPath, control.URL)
	transport := &redialCounter{}
	host.conn = transport

	host.remeasureAndRelink(context.Background())

	if transport.redials.Load() != 1 {
		t.Errorf("expected exactly one re-dial, got %d", transport.redials.Load())
	}
	// And it measured rather than merely re-dialling: a choice made on nothing is what this exists
	// to avoid.
	if health := host.lines.Health().Get("origin"); !health.Measured {
		t.Error("re-dialled without measuring anything")
	}
}

// A transport with nothing to re-dial — the one-shot HTTP one — must not be a crash.
func TestRemeasureIsHarmlessOnATransportThatCannotRedial(t *testing.T) {
	dir := t.TempDir()
	host := hostWithLines(t, multipath.Line{ID: "origin", URL: ""})
	host.cfgPath = dir + "/config.json"
	host.apiBase = "http://127.0.0.1:1/mt"
	host.lines = lines.New(host.cfgPath, "http://127.0.0.1:1")
	host.conn = struct{ protocol.Transport }{}

	host.remeasureAndRelink(context.Background())
}
