// What the machine says when it cannot reach the server.
//
// This is the gap that made a real incident undiagnosable: the connector retried forever and wrote
// nothing, so the window in which a machine was unreachable left no trace at all — the log showed
// only the successful sessions on either side of it. Absence of evidence read exactly like health.
//
// So the assertions here are about the LOG TEXT, which is unusual and deliberate: the log is the
// deliverable. Each of these was watched fail before the logging existed.
package host

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	multipath "github.com/micro-teams/multipath/go"
)

// quietHost builds a Host whose narration goes to a buffer and whose clock a test can move.
func quietHost(t *testing.T) (*Host, *bytes.Buffer, *time.Time) {
	t.Helper()
	client := multipath.New(multipath.Options{Registry: multipath.Registry{
		Lines: []multipath.Line{{ID: "origin", URL: "", Weight: 100}},
	}})
	var buf bytes.Buffer
	clock := time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC)
	h := &Host{
		lines:     client,
		linkLines: multipath.NewStreamSelector(client.Ranked, 5*time.Second, time.Minute, nil),
		logw:      &buf,
		now:       func() time.Time { return clock },
	}
	return h, &buf, &clock
}

const dialURL = "wss://microteams.example/mt/machine/link"

// The one that matters: a dial that never connected must say so, with the reason. Before this, the
// error argument was discarded (`_ error`) and the failure was completely silent.
func TestAFailedDialIsLoggedWithItsReason(t *testing.T) {
	h, log, _ := quietHost(t)

	h.reportLink(dialURL, 0, errors.New("dial tcp 1.2.3.4:443: i/o timeout"))

	out := log.String()
	if !strings.Contains(out, "cannot connect") {
		t.Fatalf("a failed dial said nothing about failing; log = %q", out)
	}
	if !strings.Contains(out, "i/o timeout") {
		t.Fatalf("the reason was dropped, which is the whole point; log = %q", out)
	}
	if !strings.Contains(out, dialURL) {
		t.Fatalf("no way to tell WHICH route failed; log = %q", out)
	}
}

// A machine can stay down for days while retrying every few seconds. Repeating the same line tens
// of thousands of times would bury the transition that matters and, on a small container, fill the
// disk. The first failure is the transition, so it is always logged; the rest are summarised.
func TestRepeatedFailuresAreSummarisedNotRepeated(t *testing.T) {
	h, log, clock := quietHost(t)
	boom := errors.New("connection refused")

	for range 100 {
		h.reportLink(dialURL, 0, boom)
		*clock = clock.Add(time.Second)
	}

	if n := strings.Count(log.String(), "cannot connect"); n != 2 {
		// 100 attempts one second apart crosses the one-minute mark exactly once after the first.
		t.Fatalf("logged %d times for 100 attempts, want 2 (first + one per minute)", n)
	}
	// The count has to travel, or a suppressed stretch reads as nothing having happened.
	if !strings.Contains(log.String(), "attempt 61") {
		t.Fatalf("the summary does not say how many attempts it stands for; log = %q", log.String())
	}
}

// The other half of the timeline. The transport reports an outcome only once a connection has
// ended, so this line is also the only record that the link was ever up — and for how long.
func TestADropAfterTimeHeldSaysHowLongItHeld(t *testing.T) {
	h, log, _ := quietHost(t)

	h.reportLink(dialURL, 3*time.Hour, errors.New("websocket: close 1006 (abnormal closure)"))

	out := log.String()
	if !strings.Contains(out, "dropped after 3h0m0s") {
		t.Fatalf("a drop must record how long the link held; log = %q", out)
	}
}

// A machine that recovers and later breaks again must announce the new break immediately, rather
// than being silenced by the rate limit left over from the previous outage.
func TestRecoveryResetsTheRateLimit(t *testing.T) {
	h, log, clock := quietHost(t)

	h.reportLink(dialURL, 0, errors.New("first outage"))
	*clock = clock.Add(time.Second)
	h.reportLink(dialURL, time.Hour, errors.New("dropped")) // it came back, then dropped
	*clock = clock.Add(time.Second)
	h.reportLink(dialURL, 0, errors.New("second outage"))

	if !strings.Contains(log.String(), "second outage") {
		t.Fatalf("the new outage was swallowed by the previous one's rate limit; log = %q", log.String())
	}
	if !strings.Contains(log.String(), "attempt 1") {
		t.Fatalf("the attempt count did not restart with the new outage; log = %q", log.String())
	}
}
