// Package host is the composition root of `microteams run`: it dials the backend and lets it open
// screens on this machine.
//
// The screens themselves are handled by micro-connector's screen manager, which is shared with the
// other products built on the same connector. What is left here is what is genuinely MicroTeams':
// how this machine is configured, what updating it means, and the bargain that keeps agents alive
// across an update.
package host

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	multipath "github.com/micro-teams/multipath/go"

	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/micro-connector/cli/screen"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/micro-connector/cli/transport/ws"
	"github.com/micro-teams/micro-connector/cli/update"
	"github.com/micro-teams/microteams/cli/internal/hostlog"
	"github.com/micro-teams/microteams/cli/internal/lines"
	"github.com/micro-teams/microteams/cli/internal/state"
)

// scrollStep is how many scrollback lines one viewer scroll message moves. The
// browser coalesces wheel/touch into discrete up/down messages, so a small step
// gives a smooth, wheel-like feel while paging through tmux copy-mode history.
const scrollStep = 3

// LoadConfig reads this machine's config from path.
func LoadConfig(path string) (*config.Config, error) { return config.Load(path) }

// Host owns the connection and the machine's own decisions; the screens belong to the manager.
type Host struct {
	mgr *screen.Manager
	// The control plane, as a transport rather than a particular one. MicroTeams runs the resident
	// WebSocket; the same host serves a one-shot HTTP transport without knowing the difference.
	conn    protocol.Transport
	tm      *terminal.Manager
	cfgPath string // for the shared screen-count state file ("" disables)
	base    string // server origin, for self-update downloads

	apiBase string // control-plane API root, for the line registry

	// The substrate: one redundant stream to the origin carried over every line at once, and the
	// lines it was dialled with. The control WebSocket is a mux stream ON this, which is why a line
	// dying is no longer a disconnection — the stream survives it underneath.
	//
	// Brought up lazily, on the first attempt that needs it, and re-dialled if it dies. Not in the
	// constructor: a machine whose network is not up yet must still start, and the transport's own
	// reconnect loop is already the right place for "try again in a moment".
	// mpMu serialises DIALLING only; the client itself is read through an atomic pointer. The
	// distinction is load-bearing: the transport reports a link coming up from its own goroutine
	// WHILE the dial that created it is still in progress, so a reader that took the dial's lock
	// would deadlock against it — which it did, and the symptom was indistinguishable from a
	// network problem (both links up, said so in the log, and then nothing ever completed).
	mpMu    sync.Mutex
	mp      atomic.Pointer[multipath.Client]
	mpLines []multipath.Line

	lineMu    sync.Mutex
	lastLines []state.LineState
	// The last screen count published, so recording a line change can rewrite the state file
	// without asking tmux again. Asking would be wrong twice over: it happens on every dial
	// attempt, and it would drag the tmux server into a code path that has nothing to do with
	// screens — including in tests, where touching the live socket has killed real agents before.
	lastScreens atomic.Int32

	// Narration of the control link, and the two seams that let a test read it: where the lines go
	// (nil means stderr) and what time it is (nil means the real clock). Both exist because the
	// thing being tested here IS the log text — asserting on it is the only way to know the machine
	// says something when it goes silent.
	linkMu       sync.Mutex
	link         state.Link
	linkLogMu    sync.Mutex
	linkFails    int
	linkLoggedAt time.Time
	logw         io.Writer
	now          func() time.Time

	ctx      context.Context
	updating atomic.Bool // guards against concurrent / re-entrant self-updates
}

// New builds a Host from cfg, talking to the control plane over the resident WebSocket — the way a
// machine that hosts long-lived screens runs. cfgPath locates the shared state file that lets CLI
// commands see how many screens are live ("" disables that).
func New(cfg *config.Config, cfgPath string) (*Host, error) {
	ctrlURL, err := cfg.ControlURL()
	if err != nil {
		return nil, err
	}

	// The control link goes over the substrate rather than beside it. Before, this process chose one
	// of several public routes per dial attempt and skipped the ones that could not hold a stream;
	// now there is nothing to choose, because the redundant transport carries every byte over every
	// line at once and delivers whichever copy arrives first. A route that cannot hold a stream is
	// simply never the one that arrives, and — the part that matters for a machine — a route dying
	// is no longer a disconnection: the mux stream this WebSocket lives on survives the link
	// underneath it being re-dialled, so the machine does not go offline while that happens.
	host := &Host{
		mpLines: lines.For(cfgPath, cfg.APIBase()),
		apiBase: cfg.APIBase(),
	}
	// See substrateDialURL: the URL given to package ws must not ask gorilla to dial its own TLS on
	// top of the substrate connection dialSubstrate hands it below.
	dialURL, err := substrateDialURL(ctrlURL)
	if err != nil {
		return nil, err
	}
	conn := ws.NewWithOptions(dialURL, cfg.Token, cfg.APIBase(), ws.Options{
		NetDial: host.dialSubstrate,
		Report:  host.reportLink,
	})
	host.logw = hostlog.Open(cfgPath)
	if err := host.init(conn, cfg, cfgPath); err != nil {
		return nil, err
	}
	return host, nil
}

// substrateDialURL turns ctrlURL into the URL package ws should actually dial: a "wss" downgraded
// to "ws", everything else unchanged.
//
// The scheme on that URL is not a description of this connection, it is an instruction to gorilla:
// negotiate TLS on top of whatever NetDial returns, or don't. dialSubstrate's net.Conn is a mux
// stream on the substrate — already carried end to end inside the TLS of the lines it rides, with
// origin terminating that TLS and splicing the exchange back into nginx as plain bytes, the same as
// a request that arrived over ordinary HTTP. Left as "wss", gorilla dialled a SECOND TLS handshake
// on top of that already-secure stream: a ClientHello written into the mux stream, answered by the
// backend's WebSocket handler with an ordinary plain upgrade response (it was never expecting a
// second TLS layer inside a stream origin had already unwrapped), which gorilla then read back and
// rejected — `tls: first record does not look like a TLS handshake`, on every attempt, forever: not
// a network hiccup the reconnect loop above would ever recover from. A short command's HTTP
// requests never hit this — RoundTrip writes the request's bytes straight onto its own mux stream
// and never asks gorilla to dial anything. The control link is the one path in this client that
// hands a substrate connection to code that also knows how to dial TLS itself.
func substrateDialURL(ctrlURL string) (string, error) {
	u, err := url.Parse(ctrlURL)
	if err != nil {
		return "", fmt.Errorf("host: bad control URL %q: %w", ctrlURL, err)
	}
	if u.Scheme == "wss" {
		u.Scheme = "ws"
	}
	return u.String(), nil
}

// dialSubstrate hands the WebSocket dialler a stream on the redundant transport, bringing that
// transport up if it is not already.
//
// Errors here are ordinary: the caller is the reconnect loop, so "the network is not there yet" is
// answered by being asked again in a moment. A client that failed to dial is dropped rather than
// kept, so the next attempt tries the whole thing afresh instead of re-using something dead.
func (h *Host) dialSubstrate(ctx context.Context, _, _ string) (net.Conn, error) {
	h.mpMu.Lock()
	defer h.mpMu.Unlock()

	if live := h.mp.Load(); live != nil {
		if st, err := live.Open(lines.AppService, nil); err == nil {
			return muxConn{st}, nil
		}
		live.Close()
		h.mp.Store(nil)
	}
	if len(h.mpLines) == 0 {
		return nil, errors.New("microteams: no line to reach the control plane over")
	}
	client, err := multipath.Dial(ctx, multipath.ClientOptions{
		Lines: h.mpLines,
		Redundant: multipath.RedundantOptions{
			// Every up/down transition, said out loud. A redundant transport hides line failure from
			// everything above it, which is its purpose and also the reason this has to be reported:
			// three of four lines can die in silence while the machine works perfectly, and the
			// first anyone would hear of it is when the last one goes.
			OnLinkState: h.reportLine,
		},
	})
	if err != nil {
		return nil, err
	}
	st, err := client.Open(lines.AppService, nil)
	if err != nil {
		client.Close()
		return nil, err
	}
	h.mp.Store(client)
	h.publishLines()
	return muxConn{st}, nil
}

// muxConn dresses a mux stream as a net.Conn for the WebSocket dialler.
//
// The deadlines are accepted and ignored, which is the honest behaviour rather than a shortcut: the
// substrate has its own liveness (a ping per link, and a link that stops producing frames is reaped
// and re-dialled), and a stream that is idle is not a stream that is broken — which is precisely the
// state a control link spends most of its life in.
type muxConn struct{ *multipath.MuxStream }

type substrateAddr struct{}

func (substrateAddr) Network() string            { return "multipath" }
func (substrateAddr) String() string             { return "origin" }
func (muxConn) LocalAddr() net.Addr              { return substrateAddr{} }
func (muxConn) RemoteAddr() net.Addr             { return substrateAddr{} }
func (muxConn) SetDeadline(time.Time) error      { return nil }
func (muxConn) SetReadDeadline(time.Time) error  { return nil }
func (muxConn) SetWriteDeadline(time.Time) error { return nil }

// reportLine narrates one line coming up or going down, and republishes the table `status` reads.
func (h *Host) reportLine(st multipath.LinkState) {
	id := h.lineID(st.Index)
	if st.Up {
		h.logf("microteams: line %s is up after %s", id, st.Duration.Round(time.Second))
	} else {
		h.logf("microteams: line %s went down after %s: %s", id, st.Duration.Round(time.Second), st.Reason)
	}
	h.publishLines()
}

func (h *Host) lineID(i int) string {
	if i < 0 || i >= len(h.mpLines) {
		return fmt.Sprintf("#%d", i)
	}
	return h.mpLines[i].ID
}

// publishLines writes the current per-line table where `microteams status` can read it.
//
// It takes no lock the dial holds, on purpose: see mpMu. A link coming up is reported from inside
// the dial, so this has to be callable from there.
func (h *Host) publishLines() {
	client := h.mp.Load()
	if client == nil {
		return
	}
	table := make([]state.LineState, 0, len(h.mpLines))
	for _, stat := range client.Stats() {
		line := state.LineState{
			ID:         h.lineID(stat.Index),
			State:      stat.State,
			Reconnects: stat.Reconnects,
			Reason:     stat.Reason,
		}
		if stat.Index >= 0 && stat.Index < len(h.mpLines) {
			line.URL = h.mpLines[stat.Index].URL
		}
		table = append(table, line)
	}
	h.lineMu.Lock()
	h.lastLines = table
	h.lineMu.Unlock()
	h.writeState(int(h.lastScreens.Load()))
}

// reportLink narrates the control link itself — not a line, which the transport underneath now
// reports separately. With the WebSocket riding a mux stream, this fires when the STREAM ends, which
// is a rarer and more meaningful event than it used to be: a line dropping no longer reaches here at
// all.
//
// It says what happened out loud, which it did not before: the error argument used to be `_`.
// The transport's reconnect loop is the only place that knows why a dial failed, it hands that
// reason to exactly one callback, and this was that callback — so a machine that could not reach
// the server wrote NOTHING to its log while retrying forever. A real machine sat like that and the
// log showed only the successful sessions on either side of the gap, which is the failure mode that
// costs the most: the silence is indistinguishable from health.
func (h *Host) reportLink(url string, held time.Duration, err error) {
	h.logLink(url, held, err)
	h.markLinkDown(err)
}

// linkLogEvery bounds how often a machine that cannot connect repeats itself. The loop retries
// every few seconds and can stay down for days, so logging every attempt would be the same fact
// tens of thousands of times — and on a small container, a log file that fills the disk.
const linkLogEvery = time.Minute

// logLink narrates the control link: every state change, and a heartbeat while it stays broken.
//
// What a reader needs from this is the transition and the reason, not the tally. So the FIRST
// failure is always logged (that is the moment the machine went away) and later ones are summarised
// at most once a minute — carrying the attempt count, so a quiet stretch reads as suppression
// rather than as nothing having happened.
//
// A drop after time held is logged unconditionally: it is rare, and it doubles as the record that
// the link had been up for that long, which is how a reader learns the machine recovered at all.
// (The transport reports an outcome only once a connection has ENDED, so there is no earlier moment
// to announce success from — see the reconnect loop in transport/ws.)
func (h *Host) logLink(url string, held time.Duration, err error) {
	h.linkLogMu.Lock()
	defer h.linkLogMu.Unlock()

	now := h.clock()
	if held > 0 {
		h.linkFails = 0
		h.linkLoggedAt = now
		h.logf("microteams: control link dropped after %s (%s): %v", held.Round(time.Second), url, err)
		return
	}

	h.linkFails++
	if h.linkFails > 1 && now.Sub(h.linkLoggedAt) < linkLogEvery {
		return
	}
	h.linkLoggedAt = now
	h.logf("microteams: control link cannot connect (attempt %d): %s: %v", h.linkFails, url, err)
}

// logf writes one line where the machine's operator will find it. Under sysv the service script
// redirects stderr to a file; under systemd it lands in the journal.
func (h *Host) logf(format string, args ...any) {
	out := h.logw
	if out == nil {
		out = os.Stderr
	}
	// Stamped, because the questions asked of this log are all about time: when did it stop
	// connecting, how long has it been like this, did it recover on its own.
	fmt.Fprintf(out, "%s "+format+"\n", append([]any{h.clock().Format(time.RFC3339)}, args...)...)
}

func (h *Host) clock() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

// markLinkUp records that the control link is established, and publishes it.
func (h *Host) markLinkUp() {
	h.linkMu.Lock()
	already := h.link.Up
	h.link = state.Link{Up: true, Since: time.Now()}
	h.linkMu.Unlock()
	if !already {
		h.logf("microteams: control link established")
	}
	h.writeState(int(h.lastScreens.Load()))
}

// markLinkDown records that it is not, and why if we know.
//
// "Why" is deliberately kept from the last attempt: a machine that has been failing for an hour
// should still be able to tell you what the failure was, and the alternative — clearing it on every
// retry — leaves whoever is looking with an empty reason exactly when they need one.
func (h *Host) markLinkDown(err error) {
	h.linkMu.Lock()
	h.link.Up = false
	h.link.Since = time.Time{}
	if err != nil {
		h.link.Error = err.Error()
	}
	h.linkMu.Unlock()
	h.writeState(int(h.lastScreens.Load()))
}

func (h *Host) currentLink() state.Link {
	h.linkMu.Lock()
	defer h.linkMu.Unlock()
	return h.link
}

func (h *Host) currentLines() []state.LineState {
	h.lineMu.Lock()
	defer h.lineMu.Unlock()
	return h.lastLines
}

// NewWithTransport builds a Host on a caller-supplied transport.
//
// The resident WebSocket is one way to reach a control plane, not the only one: a provisioning tool
// that drives a single screen to completion inside a one-shot command wants the same session
// handling and the same applets over an HTTP exchange that ends when the command does. Everything
// below this line is written to not care which it is.
func NewWithTransport(conn protocol.Transport, cfg *config.Config, cfgPath string) (*Host, error) {
	host := &Host{mpLines: lines.For(cfgPath, cfg.APIBase()), apiBase: cfg.APIBase()}
	if err := host.init(conn, cfg, cfgPath); err != nil {
		return nil, err
	}
	return host, nil
}

func (h *Host) init(conn protocol.Transport, cfg *config.Config, cfgPath string) error {
	tm, err := terminal.NewManager()
	if err != nil {
		return err
	}
	h.conn = conn
	h.tm = tm
	h.cfgPath = cfgPath
	h.base = cfg.Base
	h.apiBase = cfg.APIBase()
	return nil
}

// Run connects and serves screens until ctx is cancelled, then tears down.
func (h *Host) Run(ctx context.Context) error {
	h.ctx = ctx
	h.mgr = screen.NewManager(ctx, h.conn, h.tm)
	// How many screens are live is published where `microteams status` can read it, and an update
	// asked for by the backend is this machine's own business — the two things the shared manager
	// deliberately does not decide.
	h.mgr.OnScreensChanged = func(live int) { h.writeState(live) }
	h.mgr.OnUpdateRequested = h.performUpdate
	h.publishState()
	defer h.clearState()
	defer h.mgr.CloseAll()
	// Every screen on this machine dies with this process — deliberately, and only here: a stop is
	// a stop. An UPDATE must not do this, which is why it hands off with syscall.Exec instead of
	// returning (see performUpdate).
	defer h.tm.KillServer()

	// A manual `microteams update` signals the running service with SIGUSR2 so the
	// update happens INSIDE this process (which then hands off via syscall.Exec,
	// preserving the private tmux + its tasks). Handle it here for the lifetime of
	// the run. Note: a successful update never returns from performUpdate — it
	// replaces the process image — so none of the deferred teardown above runs.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGUSR2)
	defer signal.Stop(sig)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-sig:
				go h.performUpdate()
			}
		}
	}()

	// SIGHUP asks the same question again: which network path should this machine be on?
	//
	// A separate signal from the update one, and deliberately a cheap one. The route is chosen per
	// dial attempt, so a link that is up stays where it is — right, since dropping a healthy
	// connection every time a ranking wobbles is worse than the wobble. But a line added an hour ago
	// then has no effect until something breaks, and the only way to force the question used to be
	// stopping the service, which kills every screen on the machine. This does not: it re-reads the
	// registry, measures, and drops just the control connection, which the loop immediately redials.
	relink := make(chan os.Signal, 1)
	signal.Notify(relink, syscall.SIGHUP)
	defer signal.Stop(relink)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-relink:
				go h.relink(ctx)
			}
		}
	}()

	go h.refreshLines(ctx)

	return h.conn.Run(ctx, h.dispatch)
}

// Build is what this binary calls itself, set from main at link time. It is reported to the control
// plane on request so an operator can tell which machines are running which build — on a machine
// nobody can log into, that is often the only thing there is to go on, and without it a forced
// update is a button whose result cannot be observed.
var Build = "dev"

// dispatch handles the few messages that are this product's own business and hands everything else
// to the shared screen manager.
//
// Answering rather than announcing is deliberate. There is no "just connected" hook to announce
// from, and a message sent before the socket is up would simply be dropped; but the server knows
// exactly when a machine attaches, so it asks then — which also means the answer is refreshed at
// the one moment it matters most, after an update has swapped this process for a new one.
func (h *Host) dispatch(msg protocol.Msg) {
	// Anything arriving at all proves the control link is established — but `welcome` is the frame
	// that marks a NEW connection, so it is the one that stamps when this link came up.
	//
	// Taken from the wire rather than from the transport because the library reports how a
	// connection ENDED, not that one began; and a fact this important should come from evidence
	// that the other end is really talking to us, not from a dial returning without an error.
	if msg.T == "welcome" {
		h.markLinkUp()
	}
	if msg.T == "machine.info" {
		_ = h.conn.Send(protocol.Msg{T: "machine.info", Name: "version", Value: Build})
		return
	}
	h.mgr.Dispatch(msg)
}

// refreshLines keeps this machine's list of network paths current, and publishes it.
//
// Two jobs, and the second is the one that is easy to miss: the short `microteams api` commands
// cannot afford to fetch a routing table — they exist for a few hundred milliseconds — so they read
// what this loop cached. A resident process is the only thing here that can pay for the fetch, so
// it pays for everybody.
//
// What it no longer does is measure. Ranking lines by latency, holding a choice, and moving when
// another looked better were all answers to "which line should this connection use", and from
// MultiPath 0.2.0 that question does not exist: the transport carries every byte over every line and
// takes whichever arrives first, which is the same decision made per byte instead of per hour, with
// no measurement to go stale and no reconnect to pay when it changes its mind.
//
// Entirely best-effort. A machine that cannot reach the registry endpoint keeps the lines it has.
func (h *Host) refreshLines(ctx context.Context) {
	if err := lines.Refresh(ctx, h.apiBase, h.cfgPath); err != nil {
		// Said out loud rather than swallowed: a registry that arrived and could not be read means
		// the deployment believes it has several paths while every machine quietly uses one, and
		// that is invisible from the outside for exactly as long as one path still works.
		fmt.Fprintf(os.Stderr, "microteams: line registry unavailable, using one line: %v\n", err)
	}

	// The registry itself changes only when an operator adds or removes a path, which is rare —
	// hourly is often enough to pick it up without asking a question nobody has changed the answer
	// to.
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = lines.Refresh(ctx, h.apiBase, h.cfgPath)
		}
	}
}

// relink re-reads the registry and rebuilds the transport over whatever it now says.
//
// This is what SIGHUP asks for, and under the substrate it means something narrower than it used to:
// not "measure again and pick better", but "a line was added or removed, carry the new set". A
// redundant stream's links are fixed when it is dialled, so adopting a changed registry means
// dialling again — and the cheapest correct way to do that is to drop the control stream and let the
// transport's own loop bring everything back, which is also the path that is exercised constantly
// and therefore the one most likely to work.
//
// Nothing here touches tmux, and that is the whole point of it existing.
func (h *Host) relink(ctx context.Context) {
	if err := lines.Refresh(ctx, h.apiBase, h.cfgPath); err != nil {
		fmt.Fprintf(os.Stderr, "microteams: line registry unavailable: %v\n", err)
	}
	h.mpMu.Lock()
	h.mpLines = lines.For(h.cfgPath, h.apiBase)
	if live := h.mp.Swap(nil); live != nil {
		live.Close()
	}
	h.mpMu.Unlock()

	// Only a transport that can be asked; the HTTP-polling one has no connection to drop.
	if redialer, ok := h.conn.(interface{ Reconnect() }); ok {
		redialer.Reconnect()
	}
}

// performUpdate updates the `microteams` binary in place and hands this process off to
// it, WITHOUT tearing down the private tmux (so the hosted tasks survive). It runs
// inside the live service process: download + verify + atomic replace, then
// syscall.Exec into the new binary — which REPLACES the process image, so the
// deferred KillServer never runs and tmux + tasks live on; the new binary
// reconnects and re-adopts the surviving screens. Any failure keeps the current
// process running unchanged (a failed update must never kill live tasks).
func (h *Host) performUpdate() {
	if !h.updating.CompareAndSwap(false, true) {
		return // an update is already in flight
	}
	defer h.updating.Store(false)

	if h.base == "" {
		fmt.Fprintln(os.Stderr, "microteams: update requested but no server base is configured")
		return
	}
	self, err := update.SelfPath()
	if err != nil {
		fmt.Fprintf(os.Stderr, "microteams: update: cannot locate self: %v\n", err)
		return
	}
	tmp, err := update.Fetch(h.ctx, h.base)
	if err != nil {
		fmt.Fprintf(os.Stderr, "microteams: update aborted (kept running current build): %v\n", err)
		return
	}
	if err := update.Replace(tmp, self); err != nil {
		fmt.Fprintf(os.Stderr, "microteams: update aborted (kept running current build): %v\n", err)
		return
	}
	// Detach any live viewer pty clients (but NOT the tmux sessions) before the exec.
	// syscall.Exec skips the deferred closeAll, so an attached viewer's tmux client
	// (a child process) would otherwise survive as an ORPHAN still attached to the
	// session — and with `window-size latest` it fights the fresh viewer the new
	// binary attaches, leaving the live screen garbled/unopenable. Closing the client here only
	// tears down the viewer relay; the program/task in the tmux session lives on and
	// the new binary re-adopts it, then a re-subscribe attaches a clean single viewer.
	h.mgr.CloseViewerClients()
	fmt.Fprintln(os.Stderr, "microteams: binary updated in place; handing off to the new build (tasks preserved)…")
	// syscall.Exec replaces the process image: deferred functions (KillServer!) do
	// NOT run, so the private tmux and every hosted task survive; the new image
	// reconnects and re-adopts them. If exec fails we deliberately do NOT exit —
	// the tasks must live on; the already-replaced binary applies on next restart.
	if err := syscall.Exec(self, os.Args, os.Environ()); err != nil {
		fmt.Fprintf(os.Stderr, "microteams: exec into new binary failed (applies on next restart): %v\n", err)
	}
}

// publishState writes the live screen count for `microteams status` to read. The count comes from
// tmux, never from a remembered map: after a tmux server died, the old count went on reporting
// screens nobody could open, which is worse than reporting nothing.
func (h *Host) publishState() { h.writeState(h.tm.LiveSessions()) }

func (h *Host) writeState(live int) {
	h.lastScreens.Store(int32(live))
	if h.cfgPath == "" {
		return
	}
	state.Write(h.cfgPath, live, h.currentLines(), h.currentLink())
}

func (h *Host) clearState() {
	if h.cfgPath != "" {
		state.Clear(h.cfgPath)
	}
}
