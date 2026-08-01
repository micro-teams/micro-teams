// Package link is the dial-out control channel to the server. It carries a flat
// stream of JSON messages in both directions and knows nothing about their
// meaning — session lifecycle, variables and RPC are all just message types the
// host and the server agree on. microteams always dials out, so it works from behind
// NAT; the connection reconnects with backoff and heartbeats while up.
package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/micro-teams/micro-connector/cli/protocol"
)

// Ping cadence and liveness window. We ping every pingPeriod; the peer's pong
// (or any message) resets a pongWait read deadline. If nothing arrives within
// pongWait — e.g. a half-open connection where the server died but TCP never
// closed — ReadMessage fails and the Run loop reconnects. pingPeriod must be
// comfortably under pongWait.
const (
	pingPeriod = 15 * time.Second
	pongWait   = 45 * time.Second
)

// Conn is the resident-WebSocket implementation of protocol.Transport.
var _ protocol.Transport = (*Conn)(nil)

// Conn maintains the dial-out websocket to the server.
type Conn struct {
	url    string
	token  string
	origin string // the API base we dialed, reported so the server can echo it to our screens

	mu      sync.Mutex
	conn    *websocket.Conn
	writeMu sync.Mutex
}

// New builds a Conn dialing url, authenticating with token. origin is the API base
// this machine reached the server on (which endpoint it chose); the server echoes it
// back as MICROTEAMS_API for screens it opens here, so it never assumes its own address.
func New(url, token, origin string) *Conn {
	return &Conn{url: url, token: token, origin: origin}
}

// Run dials and pumps messages to onMsg until ctx is cancelled, reconnecting
// with capped backoff on any drop.
func (c *Conn) Run(ctx context.Context, onMsg func(protocol.Msg)) error {
	backoff := time.Second
	// Keep the cap low so a machine comes back quickly after a server restart —
	// screens survive the drop locally, so we want to reattach within seconds,
	// not tens of seconds.
	const maxBackoff = 5 * time.Second
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		connected := c.runOnce(ctx, onMsg)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if connected {
			backoff = time.Second
		} else if backoff < maxBackoff {
			if backoff *= 2; backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
}

func (c *Conn) runOnce(ctx context.Context, onMsg func(protocol.Msg)) (connected bool) {
	header := http.Header{}
	if c.token != "" {
		header.Set("X-Microteams-Session", c.token)
	}
	if c.origin != "" {
		header.Set("X-Microteams-Origin", c.origin)
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, c.url, header)
	if err != nil {
		return false
	}
	defer conn.Close()

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		if c.conn == conn {
			c.conn = nil
		}
		c.mu.Unlock()
	}()

	_ = c.Send(protocol.Msg{T: "hello", V: protocol.Version})

	// Liveness: reset the read deadline on every pong (and every message below).
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	hbCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go c.pingLoop(hbCtx, conn)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return true
		}
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		var m protocol.Msg
		if json.Unmarshal(data, &m) == nil {
			onMsg(m)
		}
	}
}

// pingLoop keeps the connection provably alive: a ping every pingPeriod that the
// server auto-pongs. Writes go through writeMu so they never interleave with a
// Send. A failed write just ends the loop; the read side then errors and Run
// reconnects.
func (c *Conn) pingLoop(ctx context.Context, conn *websocket.Conn) {
	t := time.NewTicker(pingPeriod)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.writeMu.Lock()
			err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
			c.writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

var errNotConnected = errors.New("link: not connected")

// Send marshals and writes one message to the server.
func (c *Conn) Send(m protocol.Msg) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return errNotConnected
	}
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("link: marshal: %w", err)
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return conn.WriteMessage(websocket.TextMessage, data)
}
