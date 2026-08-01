// Package protocol is the language a connector and a control plane speak: the message set, and the
// version number that lets two ends of different ages recognise each other.
//
// It is deliberately separate from any transport. MicroTeams carries these messages over a resident
// WebSocket; another consumer of this connector drives one screen to completion over HTTP polling
// inside a one-shot command. The messages are the same either way, and nothing here may assume
// otherwise — the moment the protocol knows how it is being carried, the second transport becomes
// a fork rather than an implementation.
package protocol

import "context"

// Version is the wire-protocol version this build speaks. Both ends announce it
// in the opening handshake (`hello` up, `welcome` down), so a mismatch is
// detectable and future revisions can negotiate capabilities without breaking
// older peers. Bump it only for a breaking change.
const Version = 1

// Msg is the union of every field any control message uses. Only the relevant
// ones are set per message type; the rest are omitted.
type Msg struct {
	T       string            `json:"t"`
	V       int               `json:"v,omitempty"` // protocol version (hello / welcome)
	Sid     string            `json:"sid,omitempty"`
	Name    string            `json:"name,omitempty"`
	Value   any               `json:"value,omitempty"`
	ID      string            `json:"id,omitempty"`
	Args    []any             `json:"args,omitempty"`
	Error   string            `json:"error,omitempty"`
	Command []string          `json:"command,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Screen  string            `json:"screen,omitempty"`
	Cols    int               `json:"cols,omitempty"`
	Rows    int               `json:"rows,omitempty"`
	Source  string            `json:"source,omitempty"`
	// Adopt marks a session.create that re-drives a screen whose tmux session
	// already survives on the device (after a server restart or a `microteams update`
	// re-exec): the host re-establishes the runtime + driver around the existing
	// tmux instead of spawning a new session. Unknown to older peers (ignored).
	Adopt bool `json:"adopt,omitempty"`
	// Data carries base64-encoded raw terminal bytes for the direct screen
	// channel (screen.data downstream, screen.input upstream).
	Data string `json:"data,omitempty"`
	// Dir is the direction of a screen.scroll request ("up" / "down" / "bottom"):
	// the viewer paging through the pane's tmux scrollback (copy-mode). Unknown to
	// older peers (ignored).
	Dir string `json:"dir,omitempty"`
	// One-shot command execution: exec (request) / exec.cancel / exec.result.
	Cwd       string `json:"cwd,omitempty"`
	Stdin     string `json:"stdin,omitempty"`   // optional input fed to the command
	Timeout   int    `json:"timeout,omitempty"` // caller's max seconds (0 = host default)
	Stdout    string `json:"stdout,omitempty"`
	Stderr    string `json:"stderr,omitempty"`
	Exit      int    `json:"exit,omitempty"`
	Truncated bool   `json:"truncated,omitempty"` // output hit the size cap and was clipped
}

// Transport carries the message set. Implementations differ in everything except this: a resident
// WebSocket that reconnects for as long as the machine is up, or an HTTP exchange that lives only
// as long as one command.
//
// Run pumps inbound messages to onMsg until ctx is cancelled. Send is safe to call concurrently and
// may fail while the transport is between connections; a caller that must not lose the message is
// responsible for saying so again.
type Transport interface {
	Run(ctx context.Context, onMsg func(Msg)) error
	Send(m Msg) error
}
