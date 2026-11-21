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
//   - Host is one running connector: the control link, the multipath client, the screen manager and
//     the state it publishes. It is made by New and used through Run alone.
//
//   - New(cfg, cfgPath) builds a Host; cfgPath locates the state file and the log ("" disables them).
//
//   - (*Host).Run(ctx) runs the client and the control link and serves screens until ctx is done.
//     Screens outlive it: returning detaches from them, and the next start re-adopts them when the
//     backend asks. SIGUSR2 updates the binaries in place and hands off to the new one the same way.
//
//   - UnitServes(cfgPath, userService) (bool, error) is false when the installed systemd unit of
//     that variant starts the connector with another config. The service's name is the brand's, so
//     a command run with another config must not act on it. True when there is no unit file.
//
//   - Build is what the binary calls itself, reported when the backend asks.
//
//     h, err := host.New(cfg, cfgPath)
//     err = h.Run(ctx)
//     if ok, _ := host.UnitServes(cfgPath, false); !ok { ... }
package host

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/micro-teams/micro-connector/cli/brand"
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
	h := &Host{ctx: context.Background(), tm: tm, cfgPath: cfgPath, base: cfg.Base, ctrl: ctrl, grace: clientGrace, logw: hostlog.Open(cfgPath)}
	h.mp = mpclient.NewSupervisor(mpclient.Config{
		Binary:     mpclient.BinaryPath(filepath.Dir(cfgPath)),
		LinesCache: mpclient.LinesCachePath(filepath.Dir(cfgPath)),
		Base:       cfg.APIBase(),
		Previous:   state.CurrentClient(cfgPath),
		Logf:       h.logf,
		OnChange:   func() { h.writeState(int(h.lastScreens.Load())) },
		OnLive:     h.moveOntoClient,
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
	addr, live := h.mp.Await(h.ctx, h.grace)
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
	// The screens outlive this process: a stop or restart leaves every program running, and the
	// next start re-adopts them. Only `microteams uninstall` ends them.
	defer h.mgr.Detach()

	go h.mp.Run(ctx)
	defer h.mp.Stop()

	// `microteams update` signals SIGUSR2 so the update happens inside this process, which then
	// hands off with syscall.Exec.
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
// process off to the new binary: download and verify both (from the quickest line the client
// measures, or the server's own origin while it measures none, which the log says), replace both,
// detach from the screens,
// stop the client (it says goodbye to the server), then syscall.Exec. The new binary starts a fresh
// client and re-adopts the screens. Any failure before the detach keeps the current process running
// unchanged.
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
	from := h.base
	if l, ok := h.mp.Quickest(); ok {
		from = l.URL
		h.logf("microteams: update: downloading from line %s (%s, round trip %d ms), the quickest now", l.ID, l.URL, l.RTTMs)
	} else {
		h.logf("microteams: update: downloading from the server's origin: the multipath client has measured no line")
	}
	bin, err := update.Fetch(h.ctx, from, brand.Current.Name)
	if err != nil {
		h.logf("microteams: update aborted (kept running current build): %v", err)
		return
	}
	clientPath := mpclient.BinaryPath(filepath.Dir(h.cfgPath))
	clientBin, err := mpclient.Fetch(h.ctx, from, clientPath)
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
	// Detach before the exec: each viewer's tmux client would otherwise survive as an orphan and
	// fight the one the new binary attaches.
	h.mgr.Detach()
	h.mp.Stop()
	h.logf("microteams: binaries updated in place; handing off to the new build (screens preserved)")
	if err := syscall.Exec(self, os.Args, os.Environ()); err != nil {
		// This process carries on. Dialling again makes the backend re-adopt the screens it just
		// detached from; the replaced binary applies on the next start.
		h.logf("microteams: exec into the new binary failed (applies on next start): %v", err)
		go h.mp.Run(h.ctx)
		if c, ok := h.conn.(interface{ Reconnect() }); ok {
			c.Reconnect()
		}
	}
}

// UnitServes reports whether the installed systemd unit runs the connector with cfgPath.
func UnitServes(cfgPath string, userService bool) (bool, error) {
	unit, err := readUnit(userService)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return servesConfig(unit, cfgPath), nil
}

// readUnit reads the systemd unit file of a variant, where kardianos writes it.
func readUnit(userService bool) (string, error) {
	path := filepath.Join("/etc/systemd/system", brand.Current.ServiceName+".service")
	if userService {
		dir, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(dir, "systemd", "user", brand.Current.ServiceName+".service")
	}
	b, err := os.ReadFile(path)
	return string(b), err
}

// servesConfig reports whether a unit's text runs the connector with cfgPath, as kardianos writes it.
func servesConfig(unit, cfgPath string) bool {
	return strings.Contains(unit, `"--config" "`+cfgPath+`"`)
}

// publishState writes the live screen count, taken from tmux: a remembered count would go on
// reporting screens of a tmux server that has died.
func (h *Host) publishState() {
	n, err := h.tm.LiveSessions()
	if err != nil {
		h.logf("microteams: cannot count the screens: %v", err)
	}
	h.writeState(n)
}

func (h *Host) writeState(live int) {
	h.lastScreens.Store(int32(live))
	if h.cfgPath == "" {
		return
	}
	state.Write(h.cfgPath, live, h.mp.Info(), h.currentLink(), state.TmuxOf(h.tm.Bin()))
}

func (h *Host) clearState() {
	if h.cfgPath != "" {
		state.Clear(h.cfgPath)
	}
}
