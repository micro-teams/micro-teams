// Package terminal hosts programs in a private tmux server and exposes each as
// a read/write surface with change notifications. It has no idea what runs
// inside — it spawns whatever argv it is handed, snapshots the screen, writes
// bytes, and reports when the screen changed.
package terminal

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/creack/pty"
)

// Manager owns one private tmux server (a single unix socket). Every hosted
// program is a tmux session inside it, keyed by an opaque name.
type Manager struct {
	bin  string
	sock string
	conf string
}

// findTmux prefers a private tmux owned by this installation over whatever the
// host system happens to have: $MICROTEAMS_TMUX, then <user-config>/microteams/bin/tmux
// (placed there by an installer), then PATH as a last resort. This keeps the
// CLI self-contained — a machine without tmux works once the installer drops
// one in, and a machine with a quirky system tmux is never at its mercy.
func findTmux() (string, error) {
	if p := os.Getenv("MICROTEAMS_TMUX"); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	if base, err := os.UserConfigDir(); err == nil {
		p := filepath.Join(base, "microteams", "bin", "tmux")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	if p, err := exec.LookPath("tmux"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("terminal: no tmux found (install one, or place a private copy at <config>/microteams/bin/tmux)")
}

// NewManager locates tmux and provisions a private, short-path socket dir. It
// writes a tiny config that keeps a pane after its program exits: read when the
// server first starts (via -f), so it applies before any command can run and a
// program that dies instantly still leaves its output and a dead marker on
// screen instead of tearing the server down.
func NewManager() (*Manager, error) {
	bin, err := findTmux()
	if err != nil {
		return nil, err
	}
	// A STABLE per-user runtime dir — NOT a fresh MkdirTemp each start. The tmux
	// server daemonizes and outlives the microteams process; a restarted or self-updated
	// (syscall.Exec) microteams must reconnect to the SAME socket to find and re-adopt the
	// surviving sessions. A random dir per process would strand them on an orphan
	// socket (which is exactly what broke in-place update before this).
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("microteams-%d", os.Getuid()))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("terminal: runtime dir: %w", err)
	}
	conf := filepath.Join(dir, "tmux.conf")
	if err := os.WriteFile(conf, []byte("set -g remain-on-exit on\n"), 0o600); err != nil {
		return nil, fmt.Errorf("terminal: write config: %w", err)
	}
	return &Manager{bin: bin, sock: filepath.Join(dir, "t.sock"), conf: conf}, nil
}

func (m *Manager) tmux(args ...string) *exec.Cmd {
	full := append([]string{"-S", m.sock, "-f", m.conf}, args...)
	cmd := exec.Command(m.bin, full...)
	cmd.Env = append(os.Environ(), "LC_ALL=C.UTF-8", "LANG=C.UTF-8")
	return cmd
}

// KillServer tears down the whole private tmux server (and every session).
func (m *Manager) KillServer() { _ = m.tmux("kill-server").Run() }

// HasSession reports whether a tmux session named `name` already exists in this
// private server — used to re-adopt a surviving session after the microteams process
// re-execs itself (e.g. `microteams update`) without ever tearing down tmux.
func (m *Manager) HasSession(name string) bool {
	return m.tmux("has-session", "-t", name).Run() == nil
}

// Adopt wraps an already-existing tmux session (one that survived a process
// re-exec) as a Session, without spawning anything. The caller must have checked
// HasSession; the session's program keeps running untouched — only screen
// polling/relay is (re)established around it.
func (m *Manager) Adopt(name string) *Session {
	return &Session{m: m, name: name, stop: make(chan struct{})}
}

// Session is one hosted program: a tmux session polled for screen changes.
type Session struct {
	m    *Manager
	name string

	mu    sync.Mutex
	last  string
	cbs   []func()
	stop  chan struct{}
	start sync.Once
}

// Spawn launches argv in a fresh tmux session sized cols x rows, with env (a
// list of KEY=VALUE) present in the program's environment. Env is applied by
// exec'ing the program through `env`, which is both portable and inherited by
// every child process in the session.
func (m *Manager) Spawn(name string, argv, env []string, cols, rows int) (*Session, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("terminal: empty command")
	}
	if cols <= 0 {
		cols = 200
	}
	if rows <= 0 {
		rows = 50
	}
	launch := argv
	if len(env) > 0 {
		launch = append(append([]string{"env"}, env...), argv...)
	}
	args := []string{"new-session", "-d", "-s", name,
		"-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows)}
	args = append(args, launch...)
	var stderr bytes.Buffer
	cmd := m.tmux(args...)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("terminal: spawn %q: %w: %s", name, err, stderr.String())
	}
	return &Session{m: m, name: name, stop: make(chan struct{})}, nil
}

// Snapshot returns the last polled screen contents.
func (s *Session) Snapshot() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.last
}

func (s *Session) capture() string {
	var out, stderr bytes.Buffer
	cmd := s.m.tmux("capture-pane", "-t", s.name, "-p")
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if cmd.Run() != nil {
		return ""
	}
	return out.String()
}

// Attach opens a real tmux client for this session inside a pty sized exactly to
// the viewer, and streams that client's output to onData. Because it is a true
// terminal client — not a reconstruction — the bytes carry correct wrapping,
// height, cursor position and a full repaint on connect. tmux's window follows
// the client's size (window-size latest), so the program renders at exactly the
// viewer's dimensions: what the viewer sees IS the real terminal.
func (s *Session) Attach(cols, rows int, onData func([]byte)) (*Client, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	cmd := exec.Command(s.m.bin, "-S", s.m.sock, "-f", s.m.conf, "attach-session", "-t", s.name)
	cmd.Env = append(os.Environ(), "LC_ALL=C.UTF-8", "LANG=C.UTF-8", "TERM=xterm-256color")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, fmt.Errorf("terminal: attach %q: %w", s.name, err)
	}
	c := &Client{ptmx: ptmx, cmd: cmd}
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				onData(chunk)
			}
			if err != nil {
				return
			}
		}
	}()
	return c, nil
}

// Client is one attached viewer: a tmux client process on its own pty.
type Client struct {
	ptmx *os.File
	cmd  *exec.Cmd
	once sync.Once
}

// Write sends raw viewer keystrokes to the client's pty (hence to the program).
func (c *Client) Write(p []byte) error {
	_, err := c.ptmx.Write(p)
	return err
}

// Resize changes the viewer's pty size; tmux resizes the window to match and the
// program repaints — no synthetic repaint needed.
func (c *Client) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return pty.Setsize(c.ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

// Close detaches this viewer (the session itself stays alive for reattachment).
func (c *Client) Close() {
	c.once.Do(func() {
		_ = c.ptmx.Close()
		if c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
		}
		_ = c.cmd.Wait()
	})
}

// Write sends raw bytes to the session as literal input (used by the hosted
// script; viewer keystrokes go through a Client's pty instead).
func (s *Session) Write(p []byte) error {
	if len(p) == 0 {
		return nil
	}
	var stderr bytes.Buffer
	cmd := s.m.tmux("send-keys", "-t", s.name, "-l", "--", string(p))
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("terminal: write %q: %w: %s", s.name, err, stderr.String())
	}
	return nil
}

// OnChange registers fn and starts the poller on first use.
func (s *Session) OnChange(fn func()) {
	s.mu.Lock()
	s.cbs = append(s.cbs, fn)
	s.mu.Unlock()
	s.start.Do(func() { go s.poll() })
}

func (s *Session) poll() {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	ticks := 0
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			ticks++
			cur := s.capture()
			s.mu.Lock()
			changed := cur != s.last
			s.last = cur
			cbs := append([]func(){}, s.cbs...)
			s.mu.Unlock()
			// Fire on change, plus a periodic heartbeat (~every 1.2s) so a hosted
			// script can act on and retry against a *static* screen — e.g. an
			// unattended prompt waiting for a keypress that nothing else will emit.
			if changed || ticks%3 == 0 {
				for _, cb := range cbs {
					cb()
				}
			}
		}
	}
}

// Close kills the session and stops its poller.
func (s *Session) Close() error {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	return s.m.tmux("kill-session", "-t", s.name).Run()
}
