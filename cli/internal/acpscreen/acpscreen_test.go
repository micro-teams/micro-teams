package acpscreen

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeAgent is an in-process ACP agent: it answers initialize / session/new / session/resume,
// records every prompt it receives, and on each prompt plays a short scripted turn — a message,
// a tool call that needs permission, the tool's result — before ending the turn.
type fakeAgent struct {
	t       *testing.T
	in      *bufio.Scanner // what the client sends
	out     io.Writer
	mu      sync.Mutex
	prompts []string
	methods []string
	release chan struct{} // closed to let a prompt finish (nil: finish at once)
	exit    chan string
	nextID  int
	answers map[int]chan json.RawMessage
}

func startFake(t *testing.T, release chan struct{}) (*fakeAgent, Agent) {
	cr, aw := io.Pipe() // agent -> client
	ar, cw := io.Pipe() // client -> agent
	f := &fakeAgent{t: t, in: bufio.NewScanner(ar), out: aw, release: release,
		exit: make(chan string, 1), answers: map[int]chan json.RawMessage{}}
	go f.loop()
	return f, Agent{Stdin: cw, Stdout: cr, Wait: func() string { return <-f.exit }, Stderr: func() string { return "" }}
}

func (f *fakeAgent) send(v any) {
	b, _ := json.Marshal(v)
	f.mu.Lock()
	defer f.mu.Unlock()
	_, _ = f.out.Write(append(b, '\n'))
}

func (f *fakeAgent) update(session string, u map[string]any) {
	f.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": session, "update": u}})
}

// ask sends a request to the client and waits for the result.
func (f *fakeAgent) ask(method string, params any) json.RawMessage {
	f.mu.Lock()
	f.nextID++
	id := 1000 + f.nextID
	ch := make(chan json.RawMessage, 1)
	f.answers[id] = ch
	f.mu.Unlock()
	f.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	select {
	case r := <-ch:
		return r
	case <-time.After(5 * time.Second):
		f.t.Errorf("no answer to %s", method)
		return nil
	}
}

func (f *fakeAgent) loop() {
	for f.in.Scan() {
		var m rpcMessage
		if json.Unmarshal(f.in.Bytes(), &m) != nil {
			continue
		}
		if m.Method == "" && m.ID != nil { // an answer to ask()
			var id int
			_ = json.Unmarshal(*m.ID, &id)
			f.mu.Lock()
			ch := f.answers[id]
			f.mu.Unlock()
			if ch != nil {
				ch <- m.Result
			}
			continue
		}
		f.mu.Lock()
		f.methods = append(f.methods, m.Method)
		f.mu.Unlock()
		reply := func(result any) {
			f.send(map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": result})
		}
		switch m.Method {
		case "initialize":
			reply(map[string]any{"protocolVersion": 1, "agentInfo": map[string]string{"name": "fake", "version": "0"}})
		case "session/new":
			reply(map[string]any{"sessionId": "acp-1", "configOptions": []map[string]any{{
				"id": "model", "category": "model", "currentValue": `["deepseek-official","deepseek-v4-flash"]`,
				"options": []map[string]any{{"group": "deepseek-official", "options": []map[string]string{
					{"value": `["deepseek-official","deepseek-v4-flash"]`, "name": "deepseek-v4-flash"}}}},
			}}})
		case "session/resume":
			reply(map[string]any{})
		case "session/cancel":
		case "session/prompt":
			var p struct {
				SessionID string `json:"sessionId"`
				Prompt    []struct {
					Text string `json:"text"`
				} `json:"prompt"`
			}
			_ = json.Unmarshal(m.Params, &p)
			f.mu.Lock()
			f.prompts = append(f.prompts, p.Prompt[0].Text)
			f.mu.Unlock()
			go func(id *json.RawMessage, session string) {
				f.update(session, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "Looking "}})
				f.update(session, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "into it."}})
				f.update(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Run ls", "status": "pending"})
				res := f.ask("session/request_permission", map[string]any{
					"sessionId": session, "toolCall": map[string]string{"toolCallId": "t1", "title": "Run ls"},
					"options": []map[string]string{{"optionId": "no", "kind": "reject_once", "name": "No"}, {"optionId": "yes", "kind": "allow_once", "name": "Yes"}},
				})
				if !strings.Contains(string(res), `"optionId":"yes"`) {
					f.t.Errorf("permission answer = %s, want the allow_once option", res)
				}
				f.update(session, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
					"content": []map[string]any{{"type": "content", "content": map[string]string{"type": "text", "text": "a.md\nb.md"}}}})
				if f.release != nil {
					<-f.release
				}
				f.send(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]string{"stopReason": "end_turn"}})
			}(m.ID, p.SessionID)
		}
	}
}

// syncWriter is the pane: everything acp-screen paints, readable while it runs.
type syncWriter struct {
	mu sync.Mutex
	b  strings.Builder
}

func (w *syncWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}

func (w *syncWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.String()
}

// lastLine is what the screen applet sees: the status line after the final \r\n.
func (w *syncWriter) lastLine() string {
	s := w.String()
	if i := strings.LastIndex(s, "\r\n"); i >= 0 {
		s = s[i+2:]
	}
	if i := strings.LastIndex(s, clear); i >= 0 {
		s = s[i+len(clear):]
	}
	return s
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestNewSessionPromptAndTranscript(t *testing.T) {
	dir := t.TempDir()
	fake, agent := startFake(t, nil)
	inR, inW := io.Pipe()
	out := &syncWriter{}
	done := make(chan error, 1)
	go func() {
		done <- Run(Options{Session: "mt-1", Cwd: "/work", OperatorPrompt: "OPERATOR RULES", StateDir: dir, In: inR, Out: out}, agent)
	}()

	waitFor(t, "ready", func() bool { return strings.Contains(out.lastLine(), "○ ready") })
	if !strings.Contains(out.lastLine(), "deepseek-v4-flash") {
		t.Errorf("status line %q does not name the model from session/new", out.lastLine())
	}

	// What the screen applet does for `say`: a bracketed paste, then Enter.
	_, _ = inW.Write([]byte(pasteStart + "hello\nsecond line" + pasteEnd))
	_, _ = inW.Write([]byte("\r"))

	waitFor(t, "the turn to finish", func() bool {
		return strings.Contains(out.String(), "✓") && strings.Contains(out.lastLine(), "○ ready")
	})
	fake.mu.Lock()
	prompts := append([]string(nil), fake.prompts...)
	fake.mu.Unlock()
	if len(prompts) != 1 || prompts[0] != "OPERATOR RULES\n\nhello\nsecond line" {
		t.Fatalf("prompts = %q, want one prompt carrying the operator prompt and both pasted lines", prompts)
	}
	for _, want := range []string{"› hello", "› second line", "Looking into it.", "⚙ Run ls", "allowed: Run ls (auto)", "Run ls", "a.md"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("screen lacks %q:\n%s", want, out.String())
		}
	}
	b, err := os.ReadFile(filepath.Join(dir, "mt-1.json"))
	if err != nil || !strings.Contains(string(b), `"acp-1"`) {
		t.Fatalf("session mapping = %q, %v; want acp-1 stored under mt-1", b, err)
	}

	fake.exit <- "status 3"
	waitFor(t, "exit", func() bool { return strings.Contains(out.String(), "✕ exited") })
	if err := <-done; err == nil {
		t.Fatal("Run returned nil after the agent exited")
	}
}

func TestResumeUsesStoredSessionWithoutOperatorPrompt(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "mt-2.json"), []byte(`{"sessionId":"acp-old"}`), 0o600)
	fake, agent := startFake(t, nil)
	inR, inW := io.Pipe()
	out := &syncWriter{}
	go func() {
		_ = Run(Options{Session: "mt-2", Cwd: "/work", OperatorPrompt: "OPERATOR RULES", StateDir: dir, In: inR, Out: out}, agent)
	}()
	waitFor(t, "ready", func() bool { return strings.Contains(out.lastLine(), "○ ready") })
	_, _ = inW.Write([]byte("again\r"))
	waitFor(t, "a prompt", func() bool { fake.mu.Lock(); defer fake.mu.Unlock(); return len(fake.prompts) == 1 })

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.prompts[0] != "again" {
		t.Errorf("resumed prompt = %q, want the message alone (the session already had the operator prompt)", fake.prompts[0])
	}
	for _, m := range fake.methods {
		if m == "session/new" {
			t.Errorf("a stored session was resumed, but session/new was also called: %v", fake.methods)
		}
	}
	if !strings.Contains(out.String(), "resumed session acp-old") {
		t.Errorf("screen does not say it resumed:\n%s", out.String())
	}
}

func TestMessagesWhileBusyAreQueuedInOrder(t *testing.T) {
	release := make(chan struct{})
	fake, agent := startFake(t, release)
	inR, inW := io.Pipe()
	out := &syncWriter{}
	go func() { _ = Run(Options{Session: "mt-3", StateDir: t.TempDir(), In: inR, Out: out}, agent) }()
	waitFor(t, "ready", func() bool { return strings.Contains(out.lastLine(), "○ ready") })

	_, _ = inW.Write([]byte("first\r"))
	waitFor(t, "the first prompt", func() bool { fake.mu.Lock(); defer fake.mu.Unlock(); return len(fake.prompts) == 1 })
	waitFor(t, "working", func() bool { return strings.Contains(out.lastLine(), "● working") })
	_, _ = inW.Write([]byte("second\rthird\r"))
	waitFor(t, "2 queued", func() bool { return strings.Contains(out.lastLine(), "2 queued") })
	fake.mu.Lock()
	if len(fake.prompts) != 1 {
		t.Errorf("sent %d prompts while one was in flight, want 1", len(fake.prompts))
	}
	fake.mu.Unlock()

	close(release) // let every turn finish
	waitFor(t, "all three prompts", func() bool { fake.mu.Lock(); defer fake.mu.Unlock(); return len(fake.prompts) == 3 })
	fake.mu.Lock()
	got := strings.Join(fake.prompts, ",")
	fake.mu.Unlock()
	if got != "first,second,third" {
		t.Errorf("prompt order = %s, want first,second,third", got)
	}
}

func TestInputParserPasteSplitAcrossReads(t *testing.T) {
	var p inputParser
	var got []string
	for _, chunk := range []string{"\x1b[20", "0~line one\r", "line two\x1b[2", "01~", "\r", "typed\x7fD\r"} {
		for _, ev := range p.feed([]byte(chunk)) {
			if ev.submit != "" {
				got = append(got, ev.submit)
			}
		}
	}
	want := []string{"line one\nline two", "typeD"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("submitted %q, want %q", got, want)
	}
}
