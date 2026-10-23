package acpscreen

// The JSON-RPC 2.0 half of ACP (the Agent Client Protocol, https://agentclientprotocol.com) as
// it travels over an agent's stdio: one JSON object per line in each direction. We are the
// client; the agent may also call us (session/request_permission) and notify us
// (session/update), so the connection is symmetric and every message is dispatched by shape.

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

type rpcMessage struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *rpcError        `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("%s (code %d)", e.Message, e.Code) }

// handler answers what the agent sends us. A request returns (result, err); a notification's
// return values are ignored.
type handler func(method string, params json.RawMessage) (any, error)

type conn struct {
	w       io.Writer
	wmu     sync.Mutex
	mu      sync.Mutex
	nextID  int64
	pending map[int64]chan rpcMessage
	handle  handler
	log     io.Writer // full wire log, or nil
	closed  chan struct{}
	err     error
}

func newConn(r io.Reader, w io.Writer, h handler, log io.Writer) *conn {
	c := &conn{w: w, pending: map[int64]chan rpcMessage{}, handle: h, log: log, closed: make(chan struct{})}
	go c.readLoop(r)
	return c
}

func (c *conn) send(m rpcMessage) error {
	m.JSONRPC = "2.0"
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.log != nil {
		fmt.Fprintf(c.log, "> %s\n", b)
	}
	_, err = c.w.Write(append(b, '\n'))
	return err
}

// call sends a request and blocks until its response (or the connection dies).
func (c *conn) call(method string, params any, out any) error {
	raw, err := json.Marshal(params)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	ch := make(chan rpcMessage, 1)
	c.pending[id] = ch
	c.mu.Unlock()
	idRaw := json.RawMessage(fmt.Sprint(id))
	if err := c.send(rpcMessage{ID: &idRaw, Method: method, Params: raw}); err != nil {
		return err
	}
	select {
	case m := <-ch:
		if m.Error != nil {
			return m.Error
		}
		if out != nil && len(m.Result) > 0 {
			return json.Unmarshal(m.Result, out)
		}
		return nil
	case <-c.closed:
		return fmt.Errorf("%s: agent connection closed: %w", method, c.err)
	}
}

// notify sends a notification (no id, no response).
func (c *conn) notify(method string, params any) error {
	raw, err := json.Marshal(params)
	if err != nil {
		return err
	}
	return c.send(rpcMessage{Method: method, Params: raw})
}

func (c *conn) readLoop(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 64*1024*1024) // tool output can be large
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		if c.log != nil {
			c.wmu.Lock()
			fmt.Fprintf(c.log, "< %s\n", line)
			c.wmu.Unlock()
		}
		var m rpcMessage
		if json.Unmarshal(line, &m) != nil {
			continue // not JSON-RPC (an agent printing to stdout by mistake); ignore
		}
		switch {
		case m.Method != "" && m.ID != nil: // a request from the agent
			go c.answer(m)
		case m.Method != "": // a notification
			c.handle(m.Method, m.Params)
		case m.ID != nil: // a response to one of ours
			var id int64
			if json.Unmarshal(*m.ID, &id) == nil {
				c.mu.Lock()
				ch := c.pending[id]
				delete(c.pending, id)
				c.mu.Unlock()
				if ch != nil {
					ch <- m
				}
			}
		}
	}
	c.err = sc.Err()
	if c.err == nil {
		c.err = errors.New("EOF")
	}
	close(c.closed)
}

func (c *conn) answer(m rpcMessage) {
	result, err := c.handle(m.Method, m.Params)
	if err != nil {
		var re *rpcError
		if !errors.As(err, &re) {
			re = &rpcError{Code: -32603, Message: err.Error()}
		}
		_ = c.send(rpcMessage{ID: m.ID, Error: re})
		return
	}
	raw, _ := json.Marshal(result)
	_ = c.send(rpcMessage{ID: m.ID, Result: raw})
}
