// Package commandapplet runs the server-supplied CLI applet — a bundle of JavaScript that defines
// the `microteams api` command tree and handles each command. It replaces the old Restish/OpenAPI
// command generation: instead of mirroring every operation 1:1 (noise an agent cannot navigate),
// the applet declares a small, purpose-built set of commands whose handlers call the backend and
// local tools.
//
// It runs the applet in a fresh, short-lived goja VM with a synchronous host API (see
// src/runtime/host.d.ts in the applets module for the contract):
//
//	microteams.command(spec)   register a command (the "describe" phase, at load)
//	microteams.http(req)       one authenticated, blocking HTTP call to the backend
//	microteams.fs.*            local files, sandboxed to a configured root
//	microteams.exec(cmd,args)  run a local subprocess (e.g. git)
//	microteams.print(...)      write to stdout
//
// Load() runs the applet and collects the registered commands; CobraCommands() turns them into a
// cobra tree whose leaves dispatch back into the applet's handlers (the "run" phase). Everything is
// synchronous — the applet is a one-shot process, so there is no event loop or promise machinery.
package commandapplet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dop251/goja"
	"github.com/spf13/cobra"
)

// Options configures a loaded applet's host bindings.
type Options struct {
	Client  *http.Client // authenticated client for microteams.http (see internal/apiauth)
	APIBase string       // server base URL; microteams.http paths are relative to it
	FsRoot  string       // sandbox root for microteams.fs; defaults to the working directory
	Out     io.Writer    // microteams.print target; defaults to os.Stdout
}

// Applet is a loaded CLI applet: a goja VM plus the commands it registered.
type Applet struct {
	vm      *goja.Runtime
	client  *http.Client
	apiBase string
	fsRoot  string
	out     io.Writer
	roots   []*cmdSpec
}

type flagSpec struct {
	name       string
	typ        string // "string" | "int" | "bool"
	required   bool
	help       string
	def        goja.Value
	hasDefault bool
}

type cmdSpec struct {
	name        string
	short       string
	long        string
	flags       []flagSpec
	run         goja.Callable // non-nil for a leaf command
	subcommands []*cmdSpec
}

// Load runs the applet source in a fresh VM and returns it with its commands collected.
func Load(source string, opts Options) (*Applet, error) {
	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	a := &Applet{vm: vm, client: opts.Client, apiBase: strings.TrimRight(opts.APIBase, "/"), fsRoot: opts.FsRoot, out: opts.Out}
	if a.client == nil {
		a.client = http.DefaultClient
	}
	if a.out == nil {
		a.out = os.Stdout
	}
	if a.fsRoot == "" {
		if wd, err := os.Getwd(); err == nil {
			a.fsRoot = wd
		} else {
			a.fsRoot = "."
		}
	}
	if err := a.install(); err != nil {
		return nil, err
	}
	if _, err := vm.RunString(source); err != nil {
		return nil, fmt.Errorf("applet load: %w", err)
	}
	return a, nil
}

// CobraCommands builds the cobra tree for every command the applet registered.
func (a *Applet) CobraCommands() []*cobra.Command {
	cmds := make([]*cobra.Command, 0, len(a.roots))
	for _, c := range a.roots {
		cmds = append(cmds, a.toCobra(c))
	}
	return cmds
}

// --- host API install -------------------------------------------------------

func (a *Applet) install() error {
	mt := a.vm.NewObject()
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}
	must(mt.Set("command", func(call goja.FunctionCall) goja.Value {
		a.roots = append(a.roots, a.parseSpec(call.Argument(0)))
		return goja.Undefined()
	}))
	must(mt.Set("print", func(call goja.FunctionCall) goja.Value {
		parts := make([]string, len(call.Arguments))
		for i, arg := range call.Arguments {
			parts[i] = arg.String()
		}
		fmt.Fprintln(a.out, strings.Join(parts, " "))
		return goja.Undefined()
	}))
	must(mt.Set("http", a.jsHTTP))
	must(mt.Set("exec", a.jsExec))
	fs := a.vm.NewObject()
	must(fs.Set("read", a.jsFsRead))
	must(fs.Set("write", a.jsFsWrite))
	must(fs.Set("list", a.jsFsList))
	must(fs.Set("exists", a.jsFsExists))
	must(fs.Set("mkdir", a.jsFsMkdir))
	must(fs.Set("remove", a.jsFsRemove))
	must(mt.Set("fs", fs))
	return a.vm.Set("microteams", mt)
}

// --- describe: parse a command spec object ----------------------------------

func (a *Applet) parseSpec(v goja.Value) *cmdSpec {
	o := v.ToObject(a.vm)
	c := &cmdSpec{name: strOf(o.Get("name")), short: strOf(o.Get("short")), long: strOf(o.Get("long"))}
	a.forEach(o.Get("flags"), func(fv goja.Value) {
		fo := fv.ToObject(a.vm)
		f := flagSpec{name: strOf(fo.Get("name")), typ: strOf(fo.Get("type")), help: strOf(fo.Get("help"))}
		if r := fo.Get("required"); r != nil && !goja.IsUndefined(r) {
			f.required = r.ToBoolean()
		}
		if d := fo.Get("default"); d != nil && !goja.IsUndefined(d) && !goja.IsNull(d) {
			f.def = d
			f.hasDefault = true
		}
		c.flags = append(c.flags, f)
	})
	if r := o.Get("run"); r != nil {
		if fn, ok := goja.AssertFunction(r); ok {
			c.run = fn
		}
	}
	a.forEach(o.Get("commands"), func(sv goja.Value) {
		c.subcommands = append(c.subcommands, a.parseSpec(sv))
	})
	return c
}

// --- run: build cobra + dispatch back into the applet -----------------------

func (a *Applet) toCobra(c *cmdSpec) *cobra.Command {
	cmd := &cobra.Command{Use: c.name, Short: c.short, Long: c.long}
	if c.run != nil {
		for _, f := range c.flags {
			switch f.typ {
			case "int":
				cmd.Flags().Int(f.name, intDefault(f), f.help)
			case "bool":
				cmd.Flags().Bool(f.name, boolDefault(f), f.help)
			default:
				cmd.Flags().String(f.name, stringDefault(f), f.help)
			}
			if f.required {
				_ = cmd.MarkFlagRequired(f.name)
			}
		}
		spec := c
		cmd.RunE = func(cc *cobra.Command, args []string) error {
			return a.invoke(spec, cc, args)
		}
	}
	for _, sub := range c.subcommands {
		cmd.AddCommand(a.toCobra(sub))
	}
	return cmd
}

func (a *Applet) invoke(c *cmdSpec, cc *cobra.Command, args []string) error {
	flags := a.vm.NewObject()
	for _, f := range c.flags {
		// Absent optional flags are omitted (per the contract), so the applet can test for
		// undefined; a flag with an explicit default is always passed.
		if !cc.Flags().Changed(f.name) && !f.hasDefault {
			continue
		}
		switch f.typ {
		case "int":
			v, _ := cc.Flags().GetInt(f.name)
			_ = flags.Set(f.name, v)
		case "bool":
			v, _ := cc.Flags().GetBool(f.name)
			_ = flags.Set(f.name, v)
		default:
			v, _ := cc.Flags().GetString(f.name)
			_ = flags.Set(f.name, v)
		}
	}
	ctx := a.vm.NewObject()
	_ = ctx.Set("flags", flags)
	_ = ctx.Set("args", a.vm.ToValue(args))
	if _, err := c.run(goja.Undefined(), ctx); err != nil {
		return err
	}
	return nil
}

// --- microteams.http --------------------------------------------------------

func (a *Applet) jsHTTP(call goja.FunctionCall) goja.Value {
	req := call.Argument(0).ToObject(a.vm)
	method := strings.ToUpper(strOf(req.Get("method")))
	if method == "" {
		method = http.MethodGet
	}
	target := a.apiBase + strOf(req.Get("path"))
	if q := req.Get("query"); notNullish(q) {
		qo := q.ToObject(a.vm)
		vals := url.Values{}
		for _, k := range qo.Keys() {
			if v := qo.Get(k); notNullish(v) {
				vals.Set(k, v.String())
			}
		}
		if enc := vals.Encode(); enc != "" {
			target += "?" + enc
		}
	}
	var body io.Reader
	hasBody := false
	if b := req.Get("body"); notNullish(b) {
		data, err := json.Marshal(b.Export())
		if err != nil {
			panic(a.vm.ToValue("microteams.http: cannot encode body: " + err.Error()))
		}
		body = bytes.NewReader(data)
		hasBody = true
	}
	httpReq, err := http.NewRequest(method, target, body)
	if err != nil {
		panic(a.vm.ToValue("microteams.http: " + err.Error()))
	}
	if hasBody {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		panic(a.vm.ToValue("microteams.http: " + err.Error()))
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := a.vm.NewObject()
	_ = out.Set("status", resp.StatusCode)
	var parsed any
	if len(bytes.TrimSpace(raw)) > 0 && json.Unmarshal(raw, &parsed) == nil {
		_ = out.Set("body", a.vm.ToValue(parsed))
	} else {
		_ = out.Set("body", a.vm.ToValue(string(raw)))
	}
	return out
}

// --- microteams.exec --------------------------------------------------------

func (a *Applet) jsExec(call goja.FunctionCall) goja.Value {
	name := call.Argument(0).String()
	var args []string
	a.forEach(call.Argument(1), func(v goja.Value) { args = append(args, v.String()) })
	cmd := exec.Command(name, args...)
	if o := call.Argument(2); notNullish(o) {
		if cwd := strOf(o.ToObject(a.vm).Get("cwd")); cwd != "" {
			cmd.Dir = cwd
		}
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	code := 0
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
			if stderr.Len() == 0 {
				stderr.WriteString(err.Error())
			}
		}
	}
	res := a.vm.NewObject()
	_ = res.Set("code", code)
	_ = res.Set("stdout", stdout.String())
	_ = res.Set("stderr", stderr.String())
	return res
}

// --- microteams.fs (sandboxed to fsRoot) ------------------------------------

// resolve maps an applet path to a real path inside fsRoot, defeating traversal: the path is
// cleaned as if rooted at "/", so any leading ".." that would escape is collapsed away first.
func (a *Applet) resolve(p string) string {
	return filepath.Join(a.fsRoot, filepath.Clean("/"+p))
}

func (a *Applet) jsFsRead(call goja.FunctionCall) goja.Value {
	data, err := os.ReadFile(a.resolve(call.Argument(0).String()))
	if err != nil {
		panic(a.vm.ToValue("microteams.fs.read: " + err.Error()))
	}
	return a.vm.ToValue(string(data))
}

func (a *Applet) jsFsWrite(call goja.FunctionCall) goja.Value {
	p := a.resolve(call.Argument(0).String())
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		panic(a.vm.ToValue("microteams.fs.write: " + err.Error()))
	}
	if err := os.WriteFile(p, []byte(call.Argument(1).String()), 0o644); err != nil {
		panic(a.vm.ToValue("microteams.fs.write: " + err.Error()))
	}
	return goja.Undefined()
}

func (a *Applet) jsFsList(call goja.FunctionCall) goja.Value {
	entries, err := os.ReadDir(a.resolve(call.Argument(0).String()))
	if err != nil {
		panic(a.vm.ToValue("microteams.fs.list: " + err.Error()))
	}
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.Name()
	}
	return a.vm.ToValue(names)
}

func (a *Applet) jsFsExists(call goja.FunctionCall) goja.Value {
	_, err := os.Stat(a.resolve(call.Argument(0).String()))
	return a.vm.ToValue(err == nil)
}

func (a *Applet) jsFsMkdir(call goja.FunctionCall) goja.Value {
	if err := os.MkdirAll(a.resolve(call.Argument(0).String()), 0o755); err != nil {
		panic(a.vm.ToValue("microteams.fs.mkdir: " + err.Error()))
	}
	return goja.Undefined()
}

func (a *Applet) jsFsRemove(call goja.FunctionCall) goja.Value {
	if err := os.RemoveAll(a.resolve(call.Argument(0).String())); err != nil {
		panic(a.vm.ToValue("microteams.fs.remove: " + err.Error()))
	}
	return goja.Undefined()
}

// --- small helpers ----------------------------------------------------------

func (a *Applet) forEach(v goja.Value, fn func(goja.Value)) {
	if !notNullish(v) {
		return
	}
	o := v.ToObject(a.vm)
	n := o.Get("length")
	if n == nil {
		return
	}
	for i := 0; i < int(n.ToInteger()); i++ {
		fn(o.Get(strconv.Itoa(i)))
	}
}

func notNullish(v goja.Value) bool {
	return v != nil && !goja.IsUndefined(v) && !goja.IsNull(v)
}

func strOf(v goja.Value) string {
	if !notNullish(v) {
		return ""
	}
	return v.String()
}

func stringDefault(f flagSpec) string {
	if f.hasDefault {
		return f.def.String()
	}
	return ""
}

func intDefault(f flagSpec) int {
	if f.hasDefault {
		return int(f.def.ToInteger())
	}
	return 0
}

func boolDefault(f flagSpec) bool {
	if f.hasDefault {
		return f.def.ToBoolean()
	}
	return false
}
