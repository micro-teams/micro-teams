// Package mpclient runs and finds the MultiPath client: the separate process that carries this
// machine's traffic to the deployment over every line the deployment publishes.
//
// The client is multipath-client, built from the multipath module pinned in go.mod and shipped
// beside microteams. It is a local TCP port: every connection a program opens to it becomes one
// stream to the deployment's nginx, carried over all lines at once, so a line dying is not a
// disconnection. The resident service supervises one client; its control link and the short
// `microteams api` commands both connect to the client's port. When there is no client with a live
// session, both go to the server directly and say so in their log.
//
//   - BinaryPath(cfgDir) is where the client lives: <config dir>/bin/multipath-client, beside the
//     private tmux and owned by the user the service runs as, so the service can replace it.
//
//   - LinesCachePath(cfgDir) is where the client keeps the last line list the deployment served:
//     <config dir>/multipath-lines.json. A client that starts while the deployment's origin is
//     unreachable starts its session from it, over lines that may well be working.
//
//   - Fetch(ctx, base, dest) downloads the client for this platform from the server's
//     /connector/latest/<os>-<arch>/multipath-client (where the microteams binary comes from) into a
//     temporary file beside dest and checks that it runs; it returns the temporary file's path, which
//     the caller renames onto dest. Install(ctx, base, dest) does both.
//
//   - NewSupervisor(Config) and (*Supervisor).Run(ctx) keep a client running: it is installed first
//     if missing, started on two free loopback ports (one for streams, one for its /status), polled
//     every second, and started again whenever it exits (after 1 s, doubling to 30 s), always with
//     the same line list cache (Config.LinesCache). Every start, exit and change of session is
//     logged.
//     Live() is the stream address while the client has a live session; Await(grace) waits for one
//     unless grace has passed since the client started or last lost its session (so a session
//     being replaced after a server restart is waited for, and a server that never answers is
//     not); Why() is why there is none; Info() is what the state file records; Restart() makes
//     the client start over and ask for the line list at once; Stop() ends it and returns once it
//     has exited.
//
//   - Lookup(c) checks a client recorded in the state file the way a short command needs: its
//     /status answers and its session is live. It returns the stream address, or why not.
//
//   - Transport(addr) is an http.RoundTripper that sends every request through the client at addr.
//     The request keeps its Host and travels as plain HTTP inside the stream (the lines carry the
//     TLS), and the environment's proxy is not used for it (the client applies it to the lines).
//
//   - Status(ctx, statusAddr) reads the client's /status.
//
//     sup := mpclient.NewSupervisor(mpclient.Config{Binary: mpclient.BinaryPath(dir),
//     LinesCache: mpclient.LinesCachePath(dir), Base: "https://example.app/mt", Logf: log.Printf})
//     go sup.Run(ctx)
//     if addr, ok := sup.Live(); ok {
//     client := &http.Client{Transport: mpclient.Transport(addr)}
//     }
package mpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/micro-teams/micro-connector/cli/update"
	"github.com/micro-teams/multipath/go/client"

	"github.com/micro-teams/microteams/cli/internal/state"
)

// Name is the client's file name, on the server and on the machine.
const Name = "multipath-client"

// BinaryPath is where the client lives on this machine.
func BinaryPath(cfgDir string) string { return filepath.Join(cfgDir, "bin", Name) }

// LinesCachePath is where the client keeps the last line list.
func LinesCachePath(cfgDir string) string { return filepath.Join(cfgDir, "multipath-lines.json") }

// Fetch downloads the client for this platform into a temporary file beside dest and checks that
// it runs. The caller renames the returned file onto dest, or removes it.
func Fetch(ctx context.Context, base, dest string) (string, error) {
	dir, err := update.PlatformDir()
	if err != nil {
		return "", err
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("%s: bad server base %q", Name, base)
	}
	src := u.Scheme + "://" + u.Host + "/connector/latest/" + dir + "/" + Name
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+Name+"-*")
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	fail := func(err error) (string, error) {
		_ = os.Remove(tmp.Name()) // the error below is what matters
		return "", fmt.Errorf("%s: download %s: %w", Name, src, err)
	}
	dctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(dctx, http.MethodGet, src, nil)
	if err != nil {
		return fail(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fail(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fail(fmt.Errorf("HTTP %d", resp.StatusCode))
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		return fail(err)
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		return fail(err)
	}
	// A truncated download, an error page or a wrong-architecture build fails here, before it
	// replaces anything. -h prints the flags and exits 0.
	vctx, vcancel := context.WithTimeout(ctx, 20*time.Second)
	defer vcancel()
	if out, err := exec.CommandContext(vctx, tmp.Name(), "-h").CombinedOutput(); err != nil {
		return fail(fmt.Errorf("the downloaded file does not run: %v: %.200s", err, out))
	}
	return tmp.Name(), nil
}

// Install downloads the client and moves it to dest.
func Install(ctx context.Context, base, dest string) error {
	tmp, err := Fetch(ctx, base, dest)
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp) // the rename error is what matters
		return err
	}
	return nil
}

// Config configures a Supervisor.
type Config struct {
	Binary     string                           // the client executable (BinaryPath)
	LinesCache string                           // the client's line list cache (LinesCachePath)
	Base       string                           // the server's API base; the client's entry is its origin
	Previous   state.Client                     // the client the state file recorded, ended if it still runs
	Logf       func(format string, args ...any) // the host log
	OnChange   func()                           // the client started, exited, or its session changed
	OnLive     func()                           // a session became live
}

// Supervisor keeps one client running.
type Supervisor struct {
	cfg   Config
	entry string

	restart chan struct{}
	stop    context.CancelFunc
	done    chan struct{}

	mu      sync.Mutex
	info    state.Client
	since   time.Time // when the client started, or last lost its session
	live    bool
	why     string
	session string
	changed chan struct{} // closed and replaced whenever live changes
}

// NewSupervisor returns a Supervisor for cfg; Run starts it.
func NewSupervisor(cfg Config) *Supervisor {
	entry := cfg.Base
	if u, err := url.Parse(cfg.Base); err == nil && u.Host != "" {
		entry = u.Scheme + "://" + u.Host
	}
	return &Supervisor{cfg: cfg, entry: entry, restart: make(chan struct{}, 1), since: time.Now(),
		why: "the multipath client has not started", changed: make(chan struct{})}
}

// Run keeps the client running until ctx is done or Stop is called.
func (s *Supervisor) Run(ctx context.Context) {
	ctx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	s.mu.Lock()
	s.stop, s.done = stop, done
	s.mu.Unlock()
	defer close(done)
	s.endPrevious()
	backoff := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := s.runOnce(ctx)
		s.set(state.Client{}, false, fmt.Sprintf("the multipath client is not running: %v", err), "")
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		s.cfg.Logf("multipath client: %v; starting it again in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-s.restart:
		case <-time.After(backoff):
		}
		backoff = min(2*backoff, 30*time.Second)
	}
}

// endPrevious ends a client an earlier service left running (it was killed before it could), so
// that two clients do not hold sessions for one machine. Only a process that answers as a client
// on the recorded status address is signalled, so a reused process id is left alone.
func (s *Supervisor) endPrevious() {
	p := s.cfg.Previous
	if p.PID <= 0 || p.Status == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := Status(ctx, p.Status); err != nil {
		return
	}
	s.cfg.Logf("multipath client: ending pid %d, left running by an earlier service", p.PID)
	if err := syscall.Kill(p.PID, syscall.SIGTERM); err != nil {
		s.cfg.Logf("multipath client: could not end pid %d: %v", p.PID, err)
	}
}

func (s *Supervisor) runOnce(ctx context.Context) error {
	s.mu.Lock()
	s.since = time.Now()
	s.mu.Unlock()
	if _, err := os.Stat(s.cfg.Binary); errors.Is(err, os.ErrNotExist) {
		s.cfg.Logf("multipath client: %s is missing; downloading it", s.cfg.Binary)
		if err := Install(ctx, s.cfg.Base, s.cfg.Binary); err != nil {
			return err
		}
	}
	listen, err := freePort()
	if err != nil {
		return err
	}
	status, err := freePort()
	if err != nil {
		return err
	}
	cmd := exec.Command(s.cfg.Binary, "-listen", listen, "-status", status, "-entry", s.entry, "-lines-cache", s.cfg.LinesCache)
	cmd.SysProcAttr = childAttr()
	out := &lineLog{logf: s.cfg.Logf}
	cmd.Stdout, cmd.Stderr = out, out
	if err := cmd.Start(); err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	s.set(state.Client{PID: cmd.Process.Pid, Listen: listen, Status: status}, false, "the multipath client has no session yet", "")
	s.cfg.Logf("multipath client: started pid %d, streams on %s, status on %s, entry %s", cmd.Process.Pid, listen, status, s.entry)

	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case err := <-exited:
			return fmt.Errorf("exited: %v", err)
		case <-ctx.Done():
			return terminate(cmd, exited)
		case <-s.restart:
			s.cfg.Logf("multipath client: restarting it to ask for the line list now")
			_ = terminate(cmd, exited)
			return errors.New("restarted on request")
		case <-tick.C:
			s.poll(cmd.Process.Pid, listen, status)
		}
	}
}

// poll reads the client's status and records whether its session is live.
func (s *Supervisor) poll(pid int, listen, status string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	st, err := Status(ctx, status)
	info := state.Client{PID: pid, Listen: listen, Status: status}
	if err != nil {
		s.set(info, false, fmt.Sprintf("the multipath client does not answer: %v", err), "")
		return
	}
	live, why := isLive(st)
	id := ""
	if st.Session != nil {
		id = st.Session.ID
	}
	s.set(info, live, why, id)
}

// isLive reports whether a status has a live session with a line up, and if not, why.
func isLive(st client.Status) (bool, string) {
	if st.Session == nil || st.Session.State != "live" {
		why := "the multipath client has no live session"
		if st.LastSessionEnd != "" {
			why += " (the last one ended: " + st.LastSessionEnd + ")"
		}
		for _, l := range st.Lines {
			if l.LastReason != "" {
				why += fmt.Sprintf("; line %s: %s", l.ID, l.LastReason)
				break
			}
		}
		return false, why
	}
	for _, l := range st.Lines {
		if l.State == "up" {
			return true, ""
		}
	}
	return false, "the multipath client's session has no line up"
}

func (s *Supervisor) set(info state.Client, live bool, why, session string) {
	s.mu.Lock()
	was, wasInfo, wasSession := s.live, s.info, s.session
	s.info, s.live, s.why, s.session = info, live, why, session
	if was && !live {
		s.since = time.Now()
	}
	if live != was {
		close(s.changed)
		s.changed = make(chan struct{})
	}
	s.mu.Unlock()
	switch {
	case live && (!was || session != wasSession):
		s.cfg.Logf("multipath client: session %s is live", session)
	case was && !live:
		s.cfg.Logf("multipath client: no live session: %s", why)
	}
	if live != was || info != wasInfo || session != wasSession {
		if s.cfg.OnChange != nil {
			s.cfg.OnChange()
		}
	}
	if live && !was && s.cfg.OnLive != nil {
		s.cfg.OnLive()
	}
}

// Live is the client's stream address while its session is live.
func (s *Supervisor) Live() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info.Listen, s.live
}

// Await waits for a live session unless grace has passed since the client started or last lost its
// session, so that neither a client starting nor a session being replaced sends a dial directly.
func (s *Supervisor) Await(grace time.Duration) (string, bool) {
	for {
		s.mu.Lock()
		addr, live, changed, left := s.info.Listen, s.live, s.changed, grace-time.Since(s.since)
		s.mu.Unlock()
		if live || left <= 0 {
			return addr, live
		}
		select {
		case <-changed:
		case <-time.After(left):
		}
	}
}

// Why is why there is no live session.
func (s *Supervisor) Why() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.why
}

// Info is the running client, as the state file records it.
func (s *Supervisor) Info() state.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

// Restart makes the client start over, asking for the line list at once.
func (s *Supervisor) Restart() {
	select {
	case s.restart <- struct{}{}:
	default:
	}
}

// Stop ends the client and returns once it has exited.
func (s *Supervisor) Stop() {
	s.mu.Lock()
	stop, done := s.stop, s.done
	s.mu.Unlock()
	if stop == nil {
		return
	}
	stop()
	<-done
}

// terminate asks the client to say goodbye to the server and exit, and kills it if it has not
// within three seconds.
func terminate(cmd *exec.Cmd, exited <-chan error) error {
	_ = cmd.Process.Signal(syscall.SIGTERM) // a process that already exited is reported below
	select {
	case err := <-exited:
		return fmt.Errorf("stopped: %v", err)
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		return fmt.Errorf("killed after not stopping within 3 s: %v", <-exited)
	}
}

// lineLog writes what the client prints to the host log, a line at a time.
type lineLog struct {
	mu   sync.Mutex
	buf  []byte
	logf func(format string, args ...any)
}

func (w *lineLog) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			return len(p), nil
		}
		w.logf("multipath client: %s", w.buf[:i])
		w.buf = w.buf[i+1:]
	}
}

func freePort() (string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	addr := ln.Addr().String()
	return addr, ln.Close()
}

// Lookup checks a recorded client: it answers and its session is live.
func Lookup(c state.Client) (string, error) {
	if c.PID == 0 || c.Status == "" {
		return "", errors.New("no multipath client is running (the service is not running, or predates it)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	st, err := Status(ctx, c.Status)
	if err != nil {
		return "", fmt.Errorf("the multipath client does not answer: %w", err)
	}
	if live, why := isLive(st); !live {
		return "", errors.New(why)
	}
	return c.Listen, nil
}

// Status reads the client's /status.
func Status(ctx context.Context, statusAddr string) (client.Status, error) {
	var st client.Status
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+statusAddr+"/status", nil)
	if err != nil {
		return st, err
	}
	resp, err := local.Do(req)
	if err != nil {
		return st, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return st, fmt.Errorf("status answered %d", resp.StatusCode)
	}
	return st, json.NewDecoder(resp.Body).Decode(&st)
}

// local is an HTTP client for loopback addresses: never through a proxy.
var local = &http.Client{Transport: &http.Transport{Proxy: nil}}

// Transport sends every request through the client at addr.
func Transport(addr string) http.RoundTripper {
	var d net.Dialer
	t := &http.Transport{
		Proxy:               nil,
		DialContext:         func(ctx context.Context, _, _ string) (net.Conn, error) { return d.DialContext(ctx, "tcp", addr) },
		MaxIdleConnsPerHost: 4,
		IdleConnTimeout:     30 * time.Second,
	}
	return roundTripper(func(req *http.Request) (*http.Response, error) {
		plain := req.Clone(req.Context())
		plain.URL.Scheme = "http"
		return t.RoundTrip(plain)
	})
}

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
