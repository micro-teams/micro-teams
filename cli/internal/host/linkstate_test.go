// Whether this machine is CONNECTED, as opposed to whether a process is running.
//
// The two are easy to confuse: a command that said "Connected." once the service manager returned,
// and a `status` that said connected whenever that process was alive, would both report success for
// a machine whose every dial failed while its live screen refused to open.
//
// So these tests are about one thing: the host only claims a connection when the server has
// actually spoken to it, and when it has not, it keeps the reason.
package host

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/microteams/cli/internal/mpclient"
)

func TestNoConnectionIsClaimedBeforeTheServerSpeaks(t *testing.T) {
	h, _, _ := quietHost(t)

	if h.currentLink().Up {
		t.Fatal("a host that has not heard from the server must not report a connection")
	}
}

// `welcome` is the server's first word on a new connection, so it is the evidence that the link is
// real — as opposed to a dial that returned without an error.
func TestWelcomeEstablishesTheLink(t *testing.T) {
	h, log, _ := quietHost(t)

	h.dispatch(protocol.Msg{T: "welcome", V: 1})

	link := h.currentLink()
	if !link.Up {
		t.Fatal("welcome should establish the link")
	}
	if link.Since.IsZero() {
		t.Fatal("an established link must record when")
	}
	if !contains(log.String(), "control link established") {
		t.Fatalf("the moment it connects is worth a line: %q", log.String())
	}
}

func TestAFailedDialLeavesTheLinkDownWithTheReason(t *testing.T) {
	h, _, _ := quietHost(t)

	h.reportLink(dialURL, 0, errors.New("dial tcp 10.0.0.1:443: i/o timeout"))

	link := h.currentLink()
	if link.Up {
		t.Fatal("a failed dial must not leave the link up")
	}
	if link.Error == "" {
		t.Fatal("the reason must be kept — it is what `status` shows instead of lying")
	}
}

// A connection that came up and later dropped must stop reading as connected. This is the state a
// machine sits in for hours when its network goes away.
func TestADropTakesTheLinkDown(t *testing.T) {
	h, _, _ := quietHost(t)
	h.dispatch(protocol.Msg{T: "welcome", V: 1})

	h.reportLink(dialURL, 3*time.Hour, errors.New("websocket: close 1006 abnormal closure"))

	if h.currentLink().Up {
		t.Fatal("after a drop the link is down")
	}
}

func TestReconnectingClearsTheOldFailure(t *testing.T) {
	h, _, _ := quietHost(t)
	h.reportLink(dialURL, 0, errors.New("dial tcp: i/o timeout"))

	h.dispatch(protocol.Msg{T: "welcome", V: 1})

	if link := h.currentLink(); !link.Up || link.Error != "" {
		t.Fatalf("a recovered link must not still carry the old reason: %+v", link)
	}
}

// Without a client that has a live session, the control link goes to the server directly, and the
// log says so once, with the reason.
func TestWithoutAClientTheLinkGoesDirectlyAndSaysWhy(t *testing.T) {
	h, log, _ := quietHost(t)
	h.mp = mpclient.NewSupervisor(mpclient.Config{Binary: "/nonexistent", Base: "https://control.example/mt", Logf: h.logf})
	h.ctrl = dialURL
	h.grace = 0

	if got := h.chooseURL(); got != dialURL {
		t.Fatalf("chooseURL = %q, want the configured URL %q", got, dialURL)
	}
	h.chooseURL()
	if n := strings.Count(log.String(), "goes directly"); n != 1 {
		t.Fatalf("the route was said %d times, want once; log = %q", n, log.String())
	}
	if !h.direct.Load() {
		t.Fatal("a direct link must be recorded as direct, so a live client moves it")
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
