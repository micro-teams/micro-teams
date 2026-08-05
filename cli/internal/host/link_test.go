// Which line the control link dials, and what happens to a line that cannot hold it.
//
// This is the half that ops could not diagnose from the outside: a machine whose control link keeps
// dropping looks the same whether the route is bad or the server is restarting, and until now the
// connector reconnected to the same route either way. The three things worth pinning are that a
// line is actually chosen, that a route which drops the connection immediately stops being chosen,
// and that a route which worked for a while keeps its place.

package host

import (
	"testing"
	"time"

	multipath "github.com/micro-teams/multipath/go"

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
