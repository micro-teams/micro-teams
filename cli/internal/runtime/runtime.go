// Package runtime is a generic terminal-driving engine: it hosts a piece of
// server-supplied JavaScript against a live terminal and a two-way channel to a
// server. It knows nothing about what runs in the terminal or why — no domain
// concepts appear here. The hosted script is the only thing that ascribes
// meaning; this package just gives it exactly three affordances:
//
//   - a terminal it can read and write,
//   - variables (some it owns and the server mirrors; some the server owns and
//     it mirrors),
//   - functions (some it exposes for the server to call; some the server
//     exposes for it to call).
//
// Everything runs on a single goroutine (a small event loop) so the script sees
// a consistent, race-free world: terminal-change notifications, inbound server
// messages, and resolved calls are all delivered as jobs on that loop.
package runtime

import (
	"context"
	"fmt"

	"github.com/dop251/goja"
)

// Terminal is the read/write surface the script drives. Implementations back it
// with a real pty/tmux; the runtime neither knows nor cares.
type Terminal interface {
	// Snapshot returns the current visible screen contents.
	Snapshot() string
	// Write sends bytes to the terminal (keystrokes, control sequences).
	Write(p []byte) error
	// OnChange registers fn to be called (from any goroutine) whenever the
	// screen changes. The runtime marshals it back onto its own loop.
	OnChange(fn func())
}

// Bus is the two-way channel to the server. The runtime uses it to push the
// values of script-owned variables, to invoke server functions, and to answer
// server calls; the server uses SetInbound's handler to deliver the reverse.
// It carries only names and JSON-able values — no domain shape.
type Bus interface {
	// PushVar reports a new value for a script-owned variable to the server.
	PushVar(name string, value any)
	// CallServer invokes a server-exposed function; reply is delivered later
	// (on the runtime loop) with the result or an error string.
	CallServer(id, name string, args []any)
	// ReplyServer answers a server->script call previously received.
	ReplyServer(id string, result any, errStr string)
	// SetInbound registers the sink for messages coming from the server.
	SetInbound(Inbound)
}

// Inbound is how the Bus hands server-originated events to the runtime. All
// methods may be called from any goroutine; the runtime re-marshals them onto
// its loop.
type Inbound interface {
	// SetVar delivers a new value for a server-owned variable.
	SetVar(name string, value any)
	// Invoke asks the script to run one of its exposed functions.
	Invoke(id, name string, args []any)
	// Resolve delivers the result of a prior CallServer.
	Resolve(id string, result any, errStr string)
	// LoadScript replaces the hosted script (hot update).
	LoadScript(source string)
}

// Runtime hosts one script against one terminal and one bus.
type Runtime struct {
	term Terminal
	bus  Bus

	vm   *goja.Runtime
	jobs chan func()

	// owned: script-owned variables (script r/w, server mirrors). watched:
	// server-owned variables (server r/w, script observes). Each maps a name to
	// its cached value and the script callbacks watching it.
	owned   map[string]any
	watched map[string]*watchedVar
	exposed map[string]goja.Callable
	pending map[string]*pendingCall
	callSeq int
}

type watchedVar struct {
	value     any
	listeners []goja.Callable
}

type pendingCall struct {
	resolve func(any) error
	reject  func(any) error
}

// New builds a Runtime over the given terminal and bus.
func New(term Terminal, bus Bus) *Runtime {
	r := &Runtime{
		term:    term,
		bus:     bus,
		jobs:    make(chan func(), 256),
		owned:   map[string]any{},
		watched: map[string]*watchedVar{},
		exposed: map[string]goja.Callable{},
		pending: map[string]*pendingCall{},
	}
	bus.SetInbound(r)
	term.OnChange(func() { r.enqueue(r.fireTerminalChange) })
	return r
}

// enqueue schedules fn to run on the loop. Safe from any goroutine.
func (r *Runtime) enqueue(fn func()) {
	select {
	case r.jobs <- fn:
	default:
		// Loop is backed up; run synchronously would break the single-thread
		// invariant, so block briefly — the loop drains fast.
		r.jobs <- fn
	}
}

// Run drives the event loop until ctx is cancelled. All script execution
// happens here, on this one goroutine.
func (r *Runtime) Run(ctx context.Context) error {
	r.vm = goja.New()
	r.vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	if err := r.installAPI(); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case job := <-r.jobs:
			job()
		}
	}
}

// --- inbound (server -> runtime); all just marshal onto the loop -----------

func (r *Runtime) SetVar(name string, value any) {
	r.enqueue(func() { r.applyWatched(name, value) })
}

func (r *Runtime) Invoke(id, name string, args []any) {
	r.enqueue(func() { r.runExposed(id, name, args) })
}

func (r *Runtime) Resolve(id string, result any, errStr string) {
	r.enqueue(func() { r.resolveCall(id, result, errStr) })
}

func (r *Runtime) LoadScript(source string) {
	r.enqueue(func() {
		// Hot-reload in a FRESH VM. Re-running a new script in the old vm re-declares
		// its top-level `const`/`let` in the same global scope → "Identifier X has
		// already been declared" → the reload aborts and leaves the driver corrupted.
		// A new vm (with the API re-installed and the per-script state cleared) lets a
		// normal, well-formed driver be reloaded cleanly, and drops the previous
		// script's watch listeners / exposed fns instead of leaking them. Runs on the
		// loop goroutine, the only place vm is touched, so the swap is safe.
		r.vm = goja.New()
		r.vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		r.owned = map[string]any{}
		r.watched = map[string]*watchedVar{}
		r.exposed = map[string]goja.Callable{}
		r.pending = map[string]*pendingCall{}
		if err := r.installAPI(); err != nil {
			r.logf("reload installAPI: %v", err)
			return
		}
		if _, err := r.vm.RunString(source); err != nil {
			r.logf("script error: %v", err)
		}
	})
}

// --- loop-side handlers -----------------------------------------------------

var terminalChangeFn = "__onTerminalChange"

func (r *Runtime) fireTerminalChange() {
	if fn, ok := goja.AssertFunction(r.vm.Get(terminalChangeFn)); ok {
		if _, err := fn(goja.Undefined()); err != nil {
			r.logf("onChange handler: %v", err)
		}
	}
}

func (r *Runtime) applyWatched(name string, value any) {
	w := r.watched[name]
	if w == nil {
		w = &watchedVar{}
		r.watched[name] = w
	}
	w.value = value
	for _, cb := range w.listeners {
		if _, err := cb(goja.Undefined(), r.vm.ToValue(value)); err != nil {
			r.logf("watch(%s) listener: %v", name, err)
		}
	}
}

func (r *Runtime) runExposed(id, name string, args []any) {
	fn := r.exposed[name]
	if fn == nil {
		r.bus.ReplyServer(id, nil, fmt.Sprintf("no exposed function %q", name))
		return
	}
	vals := make([]goja.Value, len(args))
	for i, a := range args {
		vals[i] = r.vm.ToValue(a)
	}
	res, err := fn(goja.Undefined(), vals...)
	if err != nil {
		r.bus.ReplyServer(id, nil, err.Error())
		return
	}
	r.bus.ReplyServer(id, res.Export(), "")
}

func (r *Runtime) resolveCall(id string, result any, errStr string) {
	p := r.pending[id]
	if p == nil {
		return
	}
	delete(r.pending, id)
	if errStr != "" {
		_ = p.reject(r.vm.ToValue(errStr))
		return
	}
	_ = p.resolve(r.vm.ToValue(result))
}

func (r *Runtime) logf(format string, a ...any) {
	if fn, ok := goja.AssertFunction(r.vm.Get("__log")); ok {
		_, _ = fn(goja.Undefined(), r.vm.ToValue(fmt.Sprintf(format, a...)))
	}
}
