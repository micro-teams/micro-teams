package runtime

import (
	"log"
	"reflect"
	"strconv"

	"github.com/dop251/goja"
)

// installAPI builds the single global the hosted script sees: `microteams`. It is
// deliberately tiny — a terminal, two flavors of variable, two directions of
// function — and carries no notion of what any of it means.
func (r *Runtime) installAPI() error {
	vm := r.vm

	// __log: default logger the runtime uses; scripts get microteams.log.
	_ = vm.Set("__log", func(msg string) { log.Printf("script: %s", msg) })

	microteams := vm.NewObject()

	// --- terminal (read/write) --------------------------------------------
	term := vm.NewObject()
	_ = term.Set("read", func(goja.FunctionCall) goja.Value {
		return vm.ToValue(r.term.Snapshot())
	})
	_ = term.Set("write", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		if err := r.term.Write(toBytes(call.Arguments[0])); err != nil {
			r.logf("term.write: %v", err)
		}
		return goja.Undefined()
	})
	_ = term.Set("onChange", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) > 0 {
			_ = vm.Set(terminalChangeFn, call.Arguments[0])
		}
		return goja.Undefined()
	})
	_ = microteams.Set("term", term)

	// --- own: script-owned variable (script r/w, server mirrors) ----------
	_ = microteams.Set("own", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		initial := exportArg(call, 1)
		r.owned[name] = initial
		r.bus.PushVar(name, initial) // seed the server's mirror

		handle := vm.NewObject()
		_ = handle.Set("get", func(goja.FunctionCall) goja.Value {
			return vm.ToValue(r.owned[name])
		})
		_ = handle.Set("set", func(c goja.FunctionCall) goja.Value {
			v := exportArg(c, 0)
			if !equal(r.owned[name], v) {
				r.owned[name] = v
				r.bus.PushVar(name, v)
			}
			return goja.Undefined()
		})
		return handle
	})

	// --- watch: server-owned variable (server r/w, script observes) -------
	_ = microteams.Set("watch", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		if _, ok := r.watched[name]; !ok {
			r.watched[name] = &watchedVar{}
		}
		handle := vm.NewObject()
		_ = handle.Set("get", func(goja.FunctionCall) goja.Value {
			return vm.ToValue(r.watched[name].value)
		})
		_ = handle.Set("onChange", func(c goja.FunctionCall) goja.Value {
			if fn, ok := goja.AssertFunction(c.Argument(0)); ok {
				r.watched[name].listeners = append(r.watched[name].listeners, fn)
			}
			return goja.Undefined()
		})
		return handle
	})

	// --- expose: a script function the server may call --------------------
	_ = microteams.Set("expose", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		if fn, ok := goja.AssertFunction(call.Argument(1)); ok {
			r.exposed[name] = fn
		}
		return goja.Undefined()
	})

	// --- call: invoke a server function, returns a Promise ----------------
	_ = microteams.Set("call", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		args := make([]any, 0, len(call.Arguments)-1)
		for _, a := range call.Arguments[1:] {
			args = append(args, a.Export())
		}
		p, resolve, reject := vm.NewPromise()
		r.callSeq++
		id := strconv.Itoa(r.callSeq)
		r.pending[id] = &pendingCall{resolve: resolve, reject: reject}
		r.bus.CallServer(id, name, args)
		return vm.ToValue(p)
	})

	_ = microteams.Set("log", func(msg string) { log.Printf("script: %s", msg) })

	return vm.Set("microteams", microteams)
}

// toBytes accepts a JS string or array-like and returns raw bytes for the pty.
func toBytes(v goja.Value) []byte {
	switch x := v.Export().(type) {
	case string:
		return []byte(x)
	case []byte:
		return x
	case []any:
		b := make([]byte, len(x))
		for i, e := range x {
			if n, ok := e.(int64); ok {
				b[i] = byte(n)
			}
		}
		return b
	default:
		return []byte(v.String())
	}
}

func exportArg(call goja.FunctionCall, i int) any {
	if i >= len(call.Arguments) {
		return nil
	}
	return call.Arguments[i].Export()
}

// equal is a cheap value comparison to suppress no-op variable pushes.
func equal(a, b any) bool {
	return reflect.DeepEqual(a, b)
}
