// Package host is the composition root of `microteams run`: it dials the server and
// lets the server open any number of screens on this machine. Each screen is a
// program in a terminal, and the server drives it two ways at once:
//
//   - through a hosted script (the applet) over a variable/function bus, and
//   - directly, as a raw byte stream to and from the terminal.
//
// The host wires those together and ascribes no meaning to any of it; all
// behavior lives in the server and its scripts.
package host

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/micro-teams/microteams/cli/internal/config"
	"github.com/micro-teams/microteams/cli/internal/link"
	"github.com/micro-teams/microteams/cli/internal/runtime"
	"github.com/micro-teams/microteams/cli/internal/state"
	"github.com/micro-teams/microteams/cli/internal/terminal"
	"github.com/micro-teams/microteams/cli/internal/update"
)

// LoadConfig reads this machine's config from path.
func LoadConfig(path string) (*config.Config, error) { return config.Load(path) }

// Host owns the connection, the tmux manager, and the live screens.
type Host struct {
	conn    *link.Conn
	tm      *terminal.Manager
	cfgPath string // for the shared screen-count state file ("" disables)
	base    string // server origin, for self-update downloads

	ctx      context.Context
	mu       sync.Mutex
	sessions map[string]*sess

	execMu sync.Mutex
	execs  map[string]context.CancelFunc // in-flight exec id -> cancel

	updating atomic.Bool // guards against concurrent / re-entrant self-updates
}

type sess struct {
	term     *terminal.Session
	rt       *runtime.Runtime
	cancel   context.CancelFunc
	client   *terminal.Client // a real tmux client (pty) while a viewer is attached
	lastCols int
	lastRows int
}

// New builds a Host from cfg. cfgPath locates the shared state file that lets
// CLI commands see how many screens are live ("" disables that).
func New(cfg *config.Config, cfgPath string) (*Host, error) {
	ctrlURL, err := cfg.ControlURL()
	if err != nil {
		return nil, err
	}
	tm, err := terminal.NewManager()
	if err != nil {
		return nil, err
	}
	return &Host{
		conn:     link.New(ctrlURL, cfg.Token, cfg.APIBase()),
		tm:       tm,
		cfgPath:  cfgPath,
		base:     cfg.Base,
		sessions: map[string]*sess{},
		execs:    map[string]context.CancelFunc{},
	}, nil
}

// Run connects and serves screens until ctx is cancelled, then tears down.
func (h *Host) Run(ctx context.Context) error {
	h.ctx = ctx
	h.publishState()
	defer h.clearState()
	defer h.closeAll()
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

	return h.conn.Run(ctx, h.onMsg)
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
	// binary attaches, leaving 现场 garbled/unopenable. Closing the client here only
	// tears down the viewer relay; the program/task in the tmux session lives on and
	// the new binary re-adopts it, then a re-subscribe attaches a clean single viewer.
	h.closeViewerClients()
	fmt.Fprintln(os.Stderr, "microteams: binary updated in place; handing off to the new build (tasks preserved)…")
	// syscall.Exec replaces the process image: deferred functions (KillServer!) do
	// NOT run, so the private tmux and every hosted task survive; the new image
	// reconnects and re-adopts them. If exec fails we deliberately do NOT exit —
	// the tasks must live on; the already-replaced binary applies on next restart.
	if err := syscall.Exec(self, os.Args, os.Environ()); err != nil {
		fmt.Fprintf(os.Stderr, "microteams: exec into new binary failed (applies on next restart): %v\n", err)
	}
}

func (h *Host) publishState() {
	if h.cfgPath == "" {
		return
	}
	h.mu.Lock()
	n := len(h.sessions)
	h.mu.Unlock()
	state.Write(h.cfgPath, n)
}

func (h *Host) clearState() {
	if h.cfgPath != "" {
		state.Clear(h.cfgPath)
	}
}

func (h *Host) onMsg(m link.Msg) {
	switch m.T {
	case "welcome":
		if m.V != 0 && m.V != link.Version {
			fmt.Fprintf(os.Stderr, "microteams: protocol version mismatch (server %d, client %d) — update microteams if things misbehave\n", m.V, link.Version)
		}
	case "session.create":
		h.createSession(m)
	case "session.close":
		h.closeSession(m.Sid)
	case "script.load":
		if s := h.session(m.Sid); s != nil {
			s.rt.LoadScript(m.Source)
		}
	case "var.set": // server-owned variable pushed down
		if s := h.session(m.Sid); s != nil {
			s.rt.SetVar(m.Name, m.Value)
		}
	case "rpc.call": // server invokes a script-exposed function
		if s := h.session(m.Sid); s != nil {
			s.rt.Invoke(m.ID, m.Name, m.Args)
		}
	case "rpc.result": // result of a script->server call
		if s := h.session(m.Sid); s != nil {
			s.rt.Resolve(m.ID, m.Value, m.Error)
		}
	case "screen.subscribe": // attach a real tmux client sized to the viewer
		h.subscribeScreen(m.Sid, m.Cols, m.Rows)
	case "screen.unsubscribe":
		h.unsubscribeScreen(m.Sid)
	case "screen.input": // raw viewer keystrokes -> the client's pty
		if s := h.session(m.Sid); s != nil && s.client != nil {
			if b, err := base64.StdEncoding.DecodeString(m.Data); err == nil {
				_ = s.client.Write(b)
			}
		}
	case "exec": // run a one-shot command on this machine and return its output
		go h.runExec(m)
	case "exec.cancel": // stop an in-flight exec (e.g. the caller's timeout fired)
		h.cancelExec(m.ID)
	case "update": // server-pushed forced update: update in place and re-exec
		go h.performUpdate()
	case "screen.resize":
		if s := h.session(m.Sid); s != nil {
			// Viewers re-send their size continuously (and on a timer) to keep the
			// real terminal matched to what they render. Resize only on an actual
			// change, so same-size pings don't make the program repaint.
			h.mu.Lock()
			changed := m.Cols != s.lastCols || m.Rows != s.lastRows
			s.lastCols, s.lastRows = m.Cols, m.Rows
			client := s.client
			h.mu.Unlock()
			if changed && client != nil {
				_ = client.Resize(m.Cols, m.Rows)
			}
		}
	}
}

func (h *Host) session(sid string) *sess {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sessions[sid]
}

func (h *Host) createSession(m link.Msg) {
	if existing := h.session(m.Sid); existing != nil {
		// Same-process reconnect: the screen is already live locally. An adopt
		// create carries the current driver source — hot-reload it into the live
		// runtime (this is how a backend restart pushes the latest applet into
		// already-running screens). A non-adopt duplicate is a harmless no-op.
		if m.Adopt && m.Source != "" {
			existing.rt.LoadScript(m.Source)
		}
		return
	}
	// The server owns the screen's identity: it hands down an opaque token in
	// m.Screen, which the host injects as MICROTEAMS_SCREEN so any process the screen
	// spawns can prove which screen it belongs to when it calls back.
	env := make([]string, 0, len(m.Env)+1)
	if m.Screen != "" {
		env = append(env, "MICROTEAMS_SCREEN="+m.Screen)
	}
	for k, v := range m.Env {
		env = append(env, k+"="+v)
	}

	// If a tmux session for this sid already exists (it survived a `microteams update`
	// re-exec or a server restart), ADOPT it: re-establish the runtime + driver +
	// polling around the still-running program instead of spawning a new session.
	// Otherwise spawn a fresh tmux session + program as usual. The server sets
	// m.Adopt on the re-provision path; HasSession is the ground truth we act on.
	var term *terminal.Session
	if h.tm.HasSession(m.Sid) {
		term = h.tm.Adopt(m.Sid)
	} else {
		var err error
		term, err = h.tm.Spawn(m.Sid, m.Command, env, m.Cols, m.Rows)
		if err != nil {
			_ = h.conn.Send(link.Msg{T: "session.error", Sid: m.Sid, Error: err.Error()})
			return
		}
	}
	rt := runtime.New(term, &busAdapter{conn: h.conn, sid: m.Sid})
	ctx, cancel := context.WithCancel(h.ctx)

	h.mu.Lock()
	h.sessions[m.Sid] = &sess{term: term, rt: rt, cancel: cancel}
	h.mu.Unlock()

	go func() { _ = rt.Run(ctx) }()

	if m.Source != "" {
		rt.LoadScript(m.Source)
	}
	_ = h.conn.Send(link.Msg{T: "session.ready", Sid: m.Sid})
	h.publishState()
}

func (h *Host) subscribeScreen(sid string, cols, rows int) {
	s := h.session(sid)
	if s == nil || s.client != nil {
		return
	}
	client, err := s.term.Attach(cols, rows, func(b []byte) {
		_ = h.conn.Send(link.Msg{T: "screen.data", Sid: sid,
			Data: base64.StdEncoding.EncodeToString(b)})
	})
	if err != nil {
		_ = h.conn.Send(link.Msg{T: "session.error", Sid: sid, Error: err.Error()})
		return
	}
	h.mu.Lock()
	s.client = client
	s.lastCols, s.lastRows = cols, rows
	h.mu.Unlock()
}

func (h *Host) unsubscribeScreen(sid string) {
	h.mu.Lock()
	s := h.sessions[sid]
	var client *terminal.Client
	if s != nil {
		client, s.client = s.client, nil
		s.lastCols, s.lastRows = 0, 0
	}
	h.mu.Unlock()
	if client != nil {
		client.Close()
	}
}

func (h *Host) closeSession(sid string) {
	h.mu.Lock()
	s := h.sessions[sid]
	delete(h.sessions, sid)
	h.mu.Unlock()
	h.teardown(s)
	h.publishState()
}

// closeViewerClients detaches every live viewer pty (s.client) WITHOUT touching the
// tmux sessions/tasks — used before a self-update exec so no viewer client orphans.
func (h *Host) closeViewerClients() {
	h.mu.Lock()
	clients := make([]*terminal.Client, 0, len(h.sessions))
	for _, s := range h.sessions {
		if s.client != nil {
			clients = append(clients, s.client)
			s.client, s.lastCols, s.lastRows = nil, 0, 0
		}
	}
	h.mu.Unlock()
	for _, c := range clients {
		c.Close()
	}
}

func (h *Host) closeAll() {
	h.mu.Lock()
	all := h.sessions
	h.sessions = map[string]*sess{}
	h.mu.Unlock()
	for _, s := range all {
		h.teardown(s)
	}
}

func (h *Host) teardown(s *sess) {
	if s == nil {
		return
	}
	if s.client != nil {
		s.client.Close()
	}
	s.cancel()
	_ = s.term.Close()
}

// execMaxOut caps each of stdout/stderr so a runaway command can't exhaust memory.
const execMaxOut = 1 << 20 // 1 MiB per stream

// runExec runs a one-shot command on this machine and returns stdout/stderr/exit
// to the server. This is a generic device capability, independent of screens —
// for setup, health checks, and other fire-and-forget device-side work. The
// caller may bound it (Timeout), feed it input (Stdin) and cancel it mid-run
// (an exec.cancel with the same ID); output beyond execMaxOut is dropped.
func (h *Host) runExec(m link.Msg) {
	if len(m.Command) == 0 {
		_ = h.conn.Send(link.Msg{T: "exec.result", ID: m.ID, Stderr: "empty command", Exit: -1})
		return
	}
	timeout := time.Duration(m.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(h.ctx, timeout)
	defer cancel()
	if m.ID != "" { // register so an exec.cancel can stop us
		h.execMu.Lock()
		h.execs[m.ID] = cancel
		h.execMu.Unlock()
		defer func() {
			h.execMu.Lock()
			delete(h.execs, m.ID)
			h.execMu.Unlock()
		}()
	}

	cmd := exec.CommandContext(ctx, m.Command[0], m.Command[1:]...)
	if m.Cwd != "" {
		cmd.Dir = m.Cwd
	}
	env := os.Environ()
	for k, v := range m.Env {
		env = append(env, k+"="+v)
	}
	cmd.Env = env
	if m.Stdin != "" {
		cmd.Stdin = strings.NewReader(m.Stdin)
	}
	stdout := &cappedBuffer{limit: execMaxOut}
	stderr := &cappedBuffer{limit: execMaxOut}
	cmd.Stdout, cmd.Stderr = stdout, stderr

	exit := 0
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			exit = -1
			if stderr.Len() == 0 {
				stderr.buf.WriteString(err.Error())
			}
		}
	}
	_ = h.conn.Send(link.Msg{T: "exec.result", ID: m.ID,
		Stdout: stdout.String(), Stderr: stderr.String(), Exit: exit,
		Truncated: stdout.truncated || stderr.truncated})
}

func (h *Host) cancelExec(id string) {
	h.execMu.Lock()
	cancel := h.execs[id]
	h.execMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// cappedBuffer accumulates up to limit bytes and silently drops the rest, so a
// runaway command's output can never blow up memory. It always reports a full
// write, so the child process is never blocked by a full pipe.
type cappedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.limit - c.buf.Len(); room > 0 {
		if len(p) > room {
			c.buf.Write(p[:room])
			c.truncated = true
		} else {
			c.buf.Write(p)
		}
	} else if len(p) > 0 {
		c.truncated = true
	}
	return len(p), nil
}

func (c *cappedBuffer) String() string { return c.buf.String() }
func (c *cappedBuffer) Len() int       { return c.buf.Len() }

// busAdapter maps one screen's runtime.Bus onto sid-tagged link messages.
type busAdapter struct {
	conn *link.Conn
	sid  string
}

func (b *busAdapter) PushVar(name string, value any) {
	_ = b.conn.Send(link.Msg{T: "var.push", Sid: b.sid, Name: name, Value: value})
}

func (b *busAdapter) CallServer(id, name string, args []any) {
	_ = b.conn.Send(link.Msg{T: "rpc.call", Sid: b.sid, ID: id, Name: name, Args: args})
}

func (b *busAdapter) ReplyServer(id string, result any, errStr string) {
	_ = b.conn.Send(link.Msg{T: "rpc.result", Sid: b.sid, ID: id, Value: result, Error: errStr})
}

// SetInbound is unused: the host routes inbound messages to the runtime directly
// (see onMsg), so the adapter needs no reference back.
func (b *busAdapter) SetInbound(runtime.Inbound) {}
