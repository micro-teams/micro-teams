// Package acpscreen is `microteams acp-screen`: a thin terminal front end for any agent that speaks
// ACP (the Agent Client Protocol) over stdio. It runs inside an agent's tmux screen in place of the
// program's own TUI, for agents that have none (DeepSeek Harness's `dsh --profile acp`): it starts
// the agent, opens or resumes a session, turns each message typed or pasted into the pane into
// session/prompt, and paints the agent's updates as a readable transcript with a one-line status
// at the bottom. To the rest of MicroTeams it is just another program in a screen — people watch
// it, and the screen applet reads its status line and pastes chat messages into it.
package acpscreen

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Agent is a running ACP agent: its stdin, its stdout, and a way to wait for it to exit.
type Agent struct {
	Stdin  io.Writer
	Stdout io.Reader
	Wait   func() (exitMsg string)
	Stderr func() string // the tail of what it wrote to stderr, for the exit message
}

type Options struct {
	Session        string // our session id (MicroTeams mints it); keys the stored ACP session
	Cwd            string
	OperatorPrompt string // prepended to the first message of a NEW session
	StateDir       string // where the session mapping lives
	In             io.Reader
	Out            io.Writer
	Width          int
	WireLog        io.Writer // the full JSON-RPC stream, or nil
	Model          string    // select this model (by its id or display name) once the session is open
	Version        string
}

type runner struct {
	opt       Options
	scr       *screen
	conn      *conn
	sessionID string
	options   json.RawMessage // the session's configOptions, as last reported

	mu       sync.Mutex
	pendKind string // the update kind being accumulated (message / thought)
	pendText strings.Builder
	tools    map[string]string // toolCallId -> title
	seenKind map[string]bool
}

// Run drives one agent until it exits or the input closes. It returns the agent's exit message.
func Run(opt Options, agent Agent) error {
	r := &runner{opt: opt, scr: newScreen(opt.Out, opt.Width), tools: map[string]string{}, seenKind: map[string]bool{}}
	r.conn = newConn(agent.Stdout, agent.Stdin, r.handle, opt.WireLog)

	exited := make(chan string, 1)
	go func() { exited <- agent.Wait() }()
	fail := func(err error) error {
		msg := err.Error()
		if tail := strings.TrimSpace(agent.Stderr()); tail != "" {
			r.scr.line(dim + firstLines(tail, 12) + reset)
		}
		r.scr.line(red + "acp-screen: " + msg + reset)
		r.scr.exited(msg)
		return err
	}

	r.scr.set("starting")
	var init struct {
		ProtocolVersion int `json:"protocolVersion"`
		AgentInfo       *struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"agentInfo"`
	}
	if err := r.conn.call("initialize", map[string]any{
		"protocolVersion":    1,
		"clientCapabilities": map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false},
		"clientInfo":         map[string]string{"name": "microteams-acp-screen", "version": opt.Version},
	}, &init); err != nil {
		return fail(err)
	}
	if init.AgentInfo != nil {
		r.scr.line(dim + fmt.Sprintf("agent: %s %s (ACP v%d)", init.AgentInfo.Name, init.AgentInfo.Version, init.ProtocolVersion) + reset)
	}

	operator, err := r.openSession()
	if err != nil {
		return fail(err)
	}
	if opt.Model != "" {
		r.selectModel(opt.Model)
	}

	events := make(chan inputEvent, 64)
	go readInput(opt.In, events)
	done := make(chan string, 1)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()

	var queue []string
	inFlight := false
	start := func() {
		if inFlight || len(queue) == 0 {
			return
		}
		text := queue[0]
		queue = queue[1:]
		r.scr.setQueued(len(queue))
		shown := text
		if operator != "" {
			text = operator + "\n\n" + text
			operator = ""
			r.scr.line(dim + "› [operator prompt]" + reset)
		}
		r.scr.line(bold + indent(firstLines(shown, 6), "› ") + reset)
		inFlight = true
		r.scr.set("working")
		go func() {
			var res struct {
				StopReason string `json:"stopReason"`
			}
			err := r.conn.call("session/prompt", map[string]any{
				"sessionId": r.sessionID,
				"prompt":    []map[string]string{{"type": "text", "text": text}},
			}, &res)
			r.flush()
			switch {
			case err != nil:
				done <- "error: " + err.Error()
			case res.StopReason != "" && res.StopReason != "end_turn":
				done <- "stopped: " + res.StopReason
			default:
				done <- ""
			}
		}()
	}

	r.scr.set("ready")
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				events = nil // input closed (no terminal); keep serving until the agent exits
				continue
			}
			switch {
			case ev.submit != "":
				queue = append(queue, ev.submit)
				if inFlight {
					r.scr.line(dim + "queued: " + clipRunes(ev.submit, 80) + reset)
				}
				r.scr.setQueued(len(queue))
				start()
			case ev.interrupt:
				if inFlight {
					r.scr.line(dim + "· cancelling…" + reset)
					_ = r.conn.notify("session/cancel", map[string]string{"sessionId": r.sessionID})
				}
			case ev.typing != nil:
				r.scr.setInput(ev.typing)
			}
		case note := <-done:
			inFlight = false
			if note != "" {
				r.scr.line(red + "· " + note + reset)
			}
			r.scr.set("ready")
			start()
		case <-tick.C:
			r.scr.tick()
		case msg := <-exited:
			r.flush()
			return fail(errors.New("agent exited: " + msg))
		}
	}
}

// openSession resumes the ACP session stored for our session id, or creates one. It returns the
// operator prompt still to be delivered (empty for a resumed session, which already had it).
func (r *runner) openSession() (string, error) {
	path := filepath.Join(r.opt.StateDir, safeName(r.opt.Session)+".json")
	var stored struct {
		SessionID string `json:"sessionId"`
	}
	if b, err := os.ReadFile(path); err == nil && json.Unmarshal(b, &stored) == nil && stored.SessionID != "" {
		var resumed struct {
			ConfigOptions json.RawMessage `json:"configOptions"`
		}
		err := r.conn.call("session/resume", map[string]any{
			"sessionId": stored.SessionID, "cwd": r.opt.Cwd, "mcpServers": []any{},
		}, &resumed)
		if err == nil {
			r.sessionID = stored.SessionID
			r.options = resumed.ConfigOptions
			if m := modelLabel(resumed.ConfigOptions); m != "" {
				r.scr.setModel(m)
			}
			r.scr.line(dim + "resumed session " + stored.SessionID + " (earlier transcript is not replayed)" + reset)
			return "", nil
		}
		r.scr.line(red + "· could not resume session " + stored.SessionID + ": " + err.Error() + "; starting a new one" + reset)
	}
	var created struct {
		SessionID     string          `json:"sessionId"`
		ConfigOptions json.RawMessage `json:"configOptions"`
	}
	if err := r.conn.call("session/new", map[string]any{"cwd": r.opt.Cwd, "mcpServers": []any{}}, &created); err != nil {
		return "", err
	}
	if created.SessionID == "" {
		return "", errors.New("session/new returned no sessionId")
	}
	r.sessionID = created.SessionID
	r.options = created.ConfigOptions
	if m := modelLabel(created.ConfigOptions); m != "" {
		r.scr.setModel(m)
	}
	if r.opt.StateDir != "" {
		_ = os.MkdirAll(r.opt.StateDir, 0o700)
		b, _ := json.Marshal(map[string]string{"sessionId": created.SessionID})
		_ = os.WriteFile(path, b, 0o600)
	}
	r.scr.line(dim + "new session " + created.SessionID + reset)
	return r.opt.OperatorPrompt, nil
}

func safeName(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return '_'
		}
		return r
	}, s)
}

func readInput(in io.Reader, events chan<- inputEvent) {
	defer close(events)
	if in == nil {
		return
	}
	var p inputParser
	buf := make([]byte, 4096)
	for {
		n, err := in.Read(buf)
		for _, ev := range p.feed(buf[:n]) {
			events <- ev
		}
		if err != nil {
			return
		}
	}
}

// handle answers what the agent sends us: its session updates, and its permission requests.
func (r *runner) handle(method string, params json.RawMessage) (any, error) {
	switch method {
	case "session/update":
		var p struct {
			Update json.RawMessage `json:"update"`
		}
		if json.Unmarshal(params, &p) == nil {
			r.render(p.Update)
		}
		return nil, nil
	case "session/request_permission":
		return r.allow(params), nil
	}
	return nil, &rpcError{Code: -32601, Message: "method not supported by acp-screen: " + method}
}

// allow answers a permission request the way the other drivers run their programs: unattended.
// It prefers a one-time allow and says on screen what it allowed.
func (r *runner) allow(params json.RawMessage) any {
	var p struct {
		ToolCall struct {
			Title string `json:"title"`
		} `json:"toolCall"`
		Options []struct {
			OptionID string `json:"optionId"`
			Kind     string `json:"kind"`
			Name     string `json:"name"`
		} `json:"options"`
	}
	_ = json.Unmarshal(params, &p)
	choice := ""
	for _, want := range []string{"allow_once", "allow_always"} {
		for _, o := range p.Options {
			if choice == "" && o.Kind == want {
				choice = o.OptionID
			}
		}
	}
	if choice == "" {
		r.scr.line(red + "· permission asked with no allow option; cancelled: " + p.ToolCall.Title + reset)
		return map[string]any{"outcome": map[string]string{"outcome": "cancelled"}}
	}
	r.scr.line(dim + "· allowed: " + p.ToolCall.Title + " (auto)" + reset)
	return map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": choice}}
}

// flush prints whatever message or thought text has been accumulating.
func (r *runner) flush() {
	r.mu.Lock()
	kind, text := r.pendKind, r.pendText.String()
	r.pendKind = ""
	r.pendText.Reset()
	r.mu.Unlock()
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	switch kind {
	case "agent_thought_chunk":
		r.scr.line(dim + "· thinking: " + clipRunes(text, 100) + reset)
	default:
		r.scr.line(text)
	}
}

func (r *runner) render(raw json.RawMessage) {
	var u struct {
		Kind       string          `json:"sessionUpdate"`
		Content    json.RawMessage `json:"content"`
		ToolCallID string          `json:"toolCallId"`
		Title      string          `json:"title"`
		Status     string          `json:"status"`
		RawInput   json.RawMessage `json:"rawInput"`
		Entries    []struct {
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"entries"`
		ConfigOptions json.RawMessage `json:"configOptions"`
		Used          *int64          `json:"used"`
		Size          *int64          `json:"size"`
	}
	if json.Unmarshal(raw, &u) != nil {
		return
	}
	switch u.Kind {
	case "agent_message_chunk", "agent_thought_chunk":
		r.mu.Lock()
		other := r.pendKind != "" && r.pendKind != u.Kind
		r.mu.Unlock()
		if other {
			r.flush()
		}
		r.mu.Lock()
		r.pendKind = u.Kind
		r.pendText.WriteString(contentText(u.Content))
		r.mu.Unlock()
		return
	case "user_message_chunk", "available_commands_update", "current_mode_update":
		return // we print what we sent ourselves; the rest is not shown
	}
	r.flush()
	switch u.Kind {
	case "tool_call":
		r.mu.Lock()
		r.tools[u.ToolCallID] = u.Title
		r.mu.Unlock()
		line := "⚙ " + u.Title
		if args := oneLineJSON(u.RawInput, 80); args != "" {
			line += dim + " " + args + reset
		}
		r.scr.line(line)
		if u.Status == "completed" || u.Status == "failed" {
			r.toolDone(u.ToolCallID, u.Title, u.Status, u.Content)
		}
	case "tool_call_update":
		if u.Status == "completed" || u.Status == "failed" {
			r.toolDone(u.ToolCallID, u.Title, u.Status, u.Content)
		}
	case "plan":
		var b strings.Builder
		b.WriteString(dim + "· plan:")
		for _, e := range u.Entries {
			mark := "○"
			switch e.Status {
			case "completed":
				mark = "✓"
			case "in_progress":
				mark = "●"
			}
			b.WriteString("\n    " + mark + " " + clipRunes(e.Content, 100))
		}
		r.scr.line(b.String() + reset)
	case "config_option_update", "config_options_update":
		if m := modelLabel(u.ConfigOptions); m != "" {
			r.scr.setModel(m)
		}
	default:
		if u.Used != nil && u.Size != nil && *u.Size > 0 {
			return // context usage; not worth a transcript line
		}
		r.mu.Lock()
		seen := r.seenKind[u.Kind]
		r.seenKind[u.Kind] = true
		r.mu.Unlock()
		if !seen && u.Kind != "" {
			r.scr.line(dim + "· (" + u.Kind + ")" + reset)
		}
	}
}

func (r *runner) toolDone(id, title, status string, content json.RawMessage) {
	r.mu.Lock()
	if title == "" {
		title = r.tools[id]
	}
	delete(r.tools, id)
	r.mu.Unlock()
	out := strings.TrimSpace(contentText(content))
	if status == "failed" {
		line := "  " + red + "✗ " + title + reset
		if out != "" {
			line += "\n" + indent(firstLines(out, 6), "    ")
		}
		r.scr.line(line)
		return
	}
	line := "  " + green + "✓" + reset + " " + title
	if out != "" {
		line += "\n" + dim + indent(firstLines(out, 4), "    ") + reset
	}
	r.scr.line(line)
}

// contentText pulls the text out of an ACP content block, or an array of tool-call content items
// ({type:"content", content:{type:"text",text}}, {type:"diff", path, ...}).
func contentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var block struct {
		Type    string          `json:"type"`
		Text    string          `json:"text"`
		Path    string          `json:"path"`
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(raw, &block) == nil && block.Type != "" {
		switch block.Type {
		case "text":
			return block.Text
		case "content":
			return contentText(block.Content)
		case "diff":
			return "(diff " + block.Path + ")"
		}
		return ""
	}
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) == nil {
		var parts []string
		for _, it := range items {
			if t := contentText(it); t != "" {
				parts = append(parts, t)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func oneLineJSON(raw json.RawMessage, max int) string {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		return ""
	}
	return clipRunes(string(raw), max)
}

// modelLabel finds the "model" config option and returns the display name of its current value.
// Options may be flat or grouped ({group, options:[…]}); the value itself is opaque (dsh uses a
// JSON-encoded [provider, model] pair), so the name is preferred when one matches.
func modelLabel(raw json.RawMessage) string {
	var opts []struct {
		ID           string            `json:"id"`
		Category     string            `json:"category"`
		CurrentValue json.RawMessage   `json:"currentValue"`
		Options      []json.RawMessage `json:"options"`
	}
	if json.Unmarshal(raw, &opts) != nil {
		return ""
	}
	for _, o := range opts {
		if o.ID != "model" && o.Category != "model" {
			continue
		}
		var cur string
		if json.Unmarshal(o.CurrentValue, &cur) != nil {
			cur = string(o.CurrentValue)
		}
		if name := optionName(o.Options, cur); name != "" {
			return name
		}
		return cur
	}
	return ""
}

func optionName(options []json.RawMessage, value string) string {
	for _, raw := range options {
		var opt struct {
			Value   string            `json:"value"`
			Name    string            `json:"name"`
			Options []json.RawMessage `json:"options"`
		}
		if json.Unmarshal(raw, &opt) != nil {
			continue
		}
		if opt.Value == value && opt.Name != "" {
			return opt.Name
		}
		if name := optionName(opt.Options, value); name != "" {
			return name
		}
	}
	return ""
}

// selectModel switches the session to the model named by want — a model id or its display name —
// through session/set_config_option. A model the agent does not offer is reported on screen and
// the session keeps its current model rather than failing to start.
func (r *runner) selectModel(want string) {
	configID, value := modelValue(r.options, want)
	if value == "" {
		r.scr.line(red + "· model " + want + " is not offered by this agent; keeping " + modelLabel(r.options) + reset)
		return
	}
	var res struct {
		ConfigOptions json.RawMessage `json:"configOptions"`
	}
	if err := r.conn.call("session/set_config_option", map[string]any{
		"sessionId": r.sessionID, "configId": configID, "value": value,
	}, &res); err != nil {
		r.scr.line(red + "· could not select model " + want + ": " + err.Error() + reset)
		return
	}
	if len(res.ConfigOptions) > 0 {
		r.options = res.ConfigOptions
	}
	if m := modelLabel(r.options); m != "" {
		r.scr.setModel(m)
	} else {
		r.scr.setModel(want)
	}
}

// modelValue finds, in the model option's choices, the value whose name or value is want. dsh's
// values are opaque JSON pairs like ["provider","model-id"], so a value ending in "want" also
// matches, and the model id alone is enough to pick it.
func modelValue(raw json.RawMessage, want string) (configID, value string) {
	var opts []struct {
		ID       string            `json:"id"`
		Category string            `json:"category"`
		Options  []json.RawMessage `json:"options"`
	}
	if json.Unmarshal(raw, &opts) != nil {
		return "", ""
	}
	for _, o := range opts {
		if o.ID != "model" && o.Category != "model" {
			continue
		}
		if v := findChoice(o.Options, want); v != "" {
			return o.ID, v
		}
	}
	return "", ""
}

func findChoice(options []json.RawMessage, want string) string {
	for _, raw := range options {
		var c struct {
			Value   string            `json:"value"`
			Name    string            `json:"name"`
			Options []json.RawMessage `json:"options"`
		}
		if json.Unmarshal(raw, &c) != nil {
			continue
		}
		if c.Value != "" && (c.Name == want || c.Value == want || strings.HasSuffix(c.Value, `"`+want+`"]`)) {
			return c.Value
		}
		if v := findChoice(c.Options, want); v != "" {
			return v
		}
	}
	return ""
}
