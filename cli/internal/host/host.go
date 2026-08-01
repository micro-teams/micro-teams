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
	"fmt"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"github.com/micro-teams/micro-connector/cli/protocol"
	"github.com/micro-teams/micro-connector/cli/screen"
	"github.com/micro-teams/micro-connector/cli/terminal"
	"github.com/micro-teams/microteams/cli/internal/config"
	"github.com/micro-teams/microteams/cli/internal/link"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/update"
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
	return NewWithTransport(link.New(ctrlURL, cfg.Token, cfg.APIBase()), cfg, cfgPath)
}

// NewWithTransport builds a Host on a caller-supplied transport.
//
// The resident WebSocket is one way to reach a control plane, not the only one: a provisioning tool
// that drives a single screen to completion inside a one-shot command wants the same session
// handling and the same applets over an HTTP exchange that ends when the command does. Everything
// below this line is written to not care which it is.
func NewWithTransport(conn protocol.Transport, cfg *config.Config, cfgPath string) (*Host, error) {
	tm, err := terminal.NewManager()
	if err != nil {
		return nil, err
	}
	return &Host{
		conn:    conn,
		tm:      tm,
		cfgPath: cfgPath,
		base:    cfg.Base,
	}, nil
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

	return h.conn.Run(ctx, h.mgr.Dispatch)
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
	if h.cfgPath == "" {
		return
	}
	state.Write(h.cfgPath, live)
}

func (h *Host) clearState() {
	if h.cfgPath != "" {
		state.Clear(h.cfgPath)
	}
}
