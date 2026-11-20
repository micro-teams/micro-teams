// Package host is the composition root of `microteams run`: it keeps the machine's control link to
// the backend up, lets the backend open screens on this machine, and runs the MultiPath client the
// link travels over.
//
// The screens are handled by micro-connector's screen manager, shared with the other products built
// on the same connector. What is here is MicroTeams' own: how the machine reaches the server, what
// it publishes in the state file, what updating means, and the bargain that keeps agents alive
// across an update.
//
// The control link is a WebSocket to <base>/machine/link. While the MultiPath client (package
// mpclient, supervised here) has a live session, the link is dialled through the client's local
// port, so it rides every line at once and a line dying is not a disconnection; otherwise it is
// dialled directly, and the log says why. When the client's session becomes live while the link is
// direct, the link is dialled again to move onto it.
//
//   - LoadConfig(path) reads the machine's config.
//
//   - New(cfg, cfgPath) builds a Host; cfgPath locates the state file and the log ("" disables them).
//
//   - (*Host).Run(ctx) runs the client and the control link and serves screens until ctx is done.
//     SIGUSR2 updates the binaries in place and hands off to the new one without stopping the
//     screens; SIGHUP starts the client over, so it fetches the line list afresh.
//
//   - Build is what the binary calls itself, reported when the backend asks.
//
//     h, err := host.New(cfg, cfgPath)
//     err = h.Run(ctx)
package host

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/micro-teams/micro-connector/cli/config"
	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/micro-connector/cli/screen"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/micro-connector/cli/transport/ws"
	"github.com/micro-teams/micro-connector/cli/update"
	"github.com/micro-teams/microteams/cli/internal/hostlog"
	"github.com/micro-teams/microteams/cli/internal/mpclient"
	"github.com/micro-teams/microteams/cli/internal/state"
)

// clientGrace is how long a freshly started client is waited for before the control link goes
// directly: long enough to fetch the line list and bring a line up over a slow path.
const clientGrace = 10 * time.Second

// LoadConfig reads this machine's config from path.
func LoadConfig(path string) (*config.Config, error) { return config.Load(path) }

// Host owns the connection and the machine's own decisions; the screens belong to the manager.
type Host struct {
	mgr     *screen.Manager
	conn    protocol.Transport
	tm      *terminal.Manager
	mp      *mpclient.Supervisor
	cfgPath string        // for the state file and the log ("" disables both)
	base    string        // the server, for self-update downloads
	ctrl    string        // the control link's URL, as configured
	grace   time.Duration // how long a dial waits for a freshly started client (clientGrace)

	// direct is whether the last dial went directly rather than through the client; route is what
	// the log last said about it, so each change is said once.
	direct  atomic.Bool
	routeMu sync.Mutex
	route   string

	lastScreens atomic.Int32 // the last screen count published, so other changes can rewrite the state file

	// The control link's narration, and the two seams that let a test read it: where the lines go
	// (nil means stderr) and what time it is (nil means the real clock).
	linkMu       sync.Mutex
	link         state.Link
	linkLogMu    sync.Mutex
	linkFails    int
	linkLoggedAt time.Time
	logw         io.Writer
	now          func() time.Time

	ctx      context.Context
	updating atomic.Bool // guards against concurrent or re-entrant self-updates
}

// New builds a Host from cfg.
func New(cfg *config.Config, cfgPath string) (*Host, error) {
	ctrl, err := cfg.ControlURL()
	if err != nil {
		return nil, err
	}
	tm, err := terminal.NewManager()
	if err != nil {
		return nil, err
	}
	h := &Host{tm: tm, cfgPath: cfgPath, base: cfg.Base, ctrl: ctrl, grace: clientGrace, logw: hostlog.Open(cfgPath)}
	h.mp = mpclient.NewSupervisor(mpclient.Config{
		Binary:   mpclient.BinaryPath(filepath.Dir(cfgPath)),
		Base:     cfg.APIBase(),
		Previous: state.CurrentClient(cfgPath),
		Logf:     h.logf,
		OnChange: func() { h.writeState(int(h.lastScreens.Load())) },
		OnLive:   h.moveOntoClient,
	})
	h.conn = ws.NewWithOptions(ctrl, cfg.Token, cfg.APIBase(), ws.Options{
		ChooseURL: h.chooseURL,
		Report:    h.reportLink,
	})
	return h, nil
}

// chooseURL is where the next dial of the control link goes: through the client while its session
// is live, directly otherwise.
func (h *Host) chooseURL() string {
	addr, live := h.mp.Await(h.grace)
	if !live {
		h.direct.Store(true)
		h.sayRoute(fmt.Sprintf("the control link goes directly to the server: %s", h.mp.Why()))
		return h.ctrl
	}
	u, err := url.Parse(h.ctrl)
	if err != nil {
		h.direct.Store(true)
		h.sayRoute(fmt.Sprintf("the control link goes directly to the server: bad control URL: %v", err))
		return h.ctrl
	}
	// Plain WebSocket to the local port: the lines underneath carry the TLS.
	u.Scheme, u.Host = "ws", addr
	h.direct.Store(false)
	h.sayRoute("the control link goes through the multipath client")
	return u.String()
}

func (h *Host) sayRoute(route string) {
	h.routeMu.Lock()
	defer h.routeMu.Unlock()
	if route != h.route {
		h.route = route
		h.logf("microteams: %s", route)
	}
}

// moveOntoClient dials the control link again when the client's session became live while the
// link was direct. The screens are not touched; the link is back within a second.
func (h *Host) moveOntoClient() {
	if !h.direct.Load() {
		return
	}
	if c, ok := h.conn.(interface{ Reconnect() }); ok {
		h.logf("microteams: the multipath client is live; moving the control link onto it")
		c.Reconnect()
	}
}

// reportLink is told how each attempt of the control link ended.
func (h *Host) reportLink(url string, held time.Duration, err error) {
	h.logLink(url, held, err)
	h.markLinkDown(err)
}

// linkLogEvery bounds how often a machine that cannot connect repeats itself: the loop retries every
// few seconds and can stay down for days.
const linkLogEvery = time.Minute

// logLink narrates the control link: the first failure always (the moment the machine went away),
// later ones at most once a minute with the attempt count, and every drop after time held (which is
// also the record that the link had been up).
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

// logf writes one stamped line to the host log (and stderr, which the init system captures).
func (h *Host) logf(format string, args ...any) {
	out := h.logw
	if out == nil {
		out = os.Stderr
	}
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

// markLinkDown records that it is not, keeping the last reason: a machine that has been failing for
// an hour should still say what the failure was.
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

// Run runs the client and the control link and serves screens until ctx is cancelled.
func (h *Host) Run(ctx context.Context) error {
	h.ctx = ctx
	h.mgr = screen.NewManager(ctx, h.conn, h.tm)
	h.mgr.OnScreensChanged = func(live int) { h.writeState(live) }
	h.mgr.OnUpdateRequested = h.performUpdate
	h.publishState()
	defer h.clearState()
	defer h.mgr.CloseAll()
	// Every screen on this machine dies with this process, and only here: a stop is a stop. An
	// update hands off with syscall.Exec instead of returning (see performUpdate).
	defer h.tm.KillServer()

	go h.mp.Run(ctx)
	defer h.mp.Stop()

	// `microteams update` signals SIGUSR2 so the update happens inside this process, which then
	// hands off with syscall.Exec and keeps the private tmux and its screens.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGUSR2)
	defer signal.Stop(sig)
	// `microteams link retest` signals SIGHUP: start the client over so it fetches the line list
	// now. The screens are not touched.
	relink := make(chan os.Signal, 1)
	signal.Notify(relink, syscall.SIGHUP)
	defer signal.Stop(relink)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-sig:
				go h.performUpdate()
			case <-relink:
				h.mp.Restart()
			}
		}
	}()

	return h.conn.Run(ctx, h.dispatch)
}

// Build is what this binary calls itself, set from main at link time and reported when the
// backend asks, so an operator can tell which machines run which build.
var Build = "dev"

// dispatch handles the messages that are this product's own business and hands everything else to
// the screen manager. `welcome` is the server's first word on a new connection, which makes it the
// evidence that the link is up.
func (h *Host) dispatch(msg protocol.Msg) {
	if msg.T == "welcome" {
		h.markLinkUp()
	}
	if msg.T == "machine.info" {
		_ = h.conn.Send(protocol.Msg{T: "machine.info", Name: "version", Value: Build})
		return
	}
	h.mgr.Dispatch(msg)
}

// performUpdate replaces the microteams binary and the multipath client in place and hands this
// process off to the new binary without tearing down the private tmux, so the hosted screens
// survive: download and verify both, replace both, stop the client (it says goodbye to the server),
// then syscall.Exec, which replaces the process image so the deferred KillServer never runs. The
// new binary starts a fresh client and re-adopts the screens. Any failure before the exec keeps the
// current process running unchanged.
func (h *Host) performUpdate() {
	if !h.updating.CompareAndSwap(false, true) {
		return
	}
	defer h.updating.Store(false)

	if h.base == "" {
		h.logf("microteams: update requested but no server base is configured")
		return
	}
	self, err := update.SelfPath()
	if err != nil {
		h.logf("microteams: update: cannot locate self: %v", err)
		return
	}
	bin, err := update.Fetch(h.ctx, h.base)
	if err != nil {
		h.logf("microteams: update aborted (kept running current build): %v", err)
		return
	}
	clientPath := mpclient.BinaryPath(filepath.Dir(h.cfgPath))
	clientBin, err := mpclient.Fetch(h.ctx, h.base, clientPath)
	if err != nil {
		_ = os.Remove(bin) // the update is abandoned; the error says why
		h.logf("microteams: update aborted (kept running current build): %v", err)
		return
	}
	if err := update.Replace(bin, self); err != nil {
		_ = os.Remove(clientBin)
		h.logf("microteams: update aborted (kept running current build): %v", err)
		return
	}
	if err := os.Rename(clientBin, clientPath); err != nil {
		h.logf("microteams: update: the new microteams is in place but the multipath client is not (%v); the next start downloads it", err)
	}
	// Detach live viewer clients (not the tmux sessions) before the exec: an attached viewer's tmux
	// client would survive as an orphan and fight the viewer the new binary attaches.
	h.mgr.CloseViewerClients()
	h.mp.Stop()
	h.logf("microteams: binaries updated in place; handing off to the new build (screens preserved)")
	// If the exec fails this process keeps running, so the screens live on; the replaced binary
	// applies on the next start.
	if err := syscall.Exec(self, os.Args, os.Environ()); err != nil {
		h.logf("microteams: exec into the new binary failed (applies on next start): %v", err)
		go h.mp.Run(h.ctx)
	}
}

// publishState writes the live screen count, taken from tmux: a remembered count would go on
// reporting screens of a tmux server that has died.
func (h *Host) publishState() { h.writeState(h.tm.LiveSessions()) }

func (h *Host) writeState(live int) {
	h.lastScreens.Store(int32(live))
	if h.cfgPath == "" {
		return
	}
	state.Write(h.cfgPath, live, h.mp.Info(), h.currentLink())
}

func (h *Host) clearState() {
	if h.cfgPath != "" {
		state.Clear(h.cfgPath)
	}
}
