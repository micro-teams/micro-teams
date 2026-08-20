// Whether this machine is CONNECTED, as opposed to whether a process is running.
//
// Those had been the same answer for as long as the product existed: `link connect` printed
// "Connected." once the service manager returned, and `status` said connected whenever that process
// was alive. A machine whose every dial failed reported success from both while its live screen
// refused to open — three surfaces agreeing on something none of them had checked.
//
// So these tests are about one thing: the host only claims a connection when the server has
// actually spoken to it, and when it has not, it keeps the reason.
package host

import (
	"errors"
	"testing"
	"time"

	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/microteams/cli/internal/state"
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

// Moving between lines is only worth a reconnect when another line is clearly and durably better.
// These pin the "leave it alone" side, which is the side that keeps a link from flapping.
func TestAYoungConnectionIsNotDisturbed(t *testing.T) {
	h, _, clock := quietHost(t)
	h.dispatch(protocol.Msg{T: "welcome", V: 1})
	h.rememberLine(state.Line{ID: "origin"})

	// Barely connected: even a better line is not worth a reconnect yet.
	*clock = clock.Add(time.Minute)

	if _, ok := h.betterLine(); ok {
		t.Fatal("a connection this young must be left alone")
	}
}

func TestADownLinkHasNothingToImprove(t *testing.T) {
	h, _, _ := quietHost(t)

	if _, ok := h.betterLine(); ok {
		t.Fatal("nothing to switch away from when nothing is connected")
	}
}

// With one line there is no choice to make, and warming up would only delay the first connection.
func TestWarmUpIsSkippedWithASingleLine(t *testing.T) {
	h, log, _ := quietHost(t)

	h.warmUpLines(t.Context())

	if log.Len() != 0 {
		t.Fatalf("nothing to measure, nothing to say: %q", log.String())
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
