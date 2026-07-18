package commandapplet

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// A registered command runs its handler, which reaches the backend through microteams.http and
// prints the result — the whole describe -> cobra -> run -> http path in one shot.
func TestAppletDefinesAndRunsCommand(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/agent/note" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"senderId": 7, "content": body["text"]})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	source := `
	  microteams.command({
	    name: 'post-note',
	    flags: [{ name: 'text', type: 'string', required: true }],
	    run: (ctx) => {
	      const res = microteams.http({ method: 'POST', path: '/agent/note', body: { text: ctx.flags['text'] } })
	      if (res.status >= 400) throw new Error('failed ' + res.status)
	      microteams.print('sent:' + res.body.content + ' by:' + res.body.senderId)
	    },
	  })
	`
	var out bytes.Buffer
	a, err := Load(source, Options{Client: srv.Client(), APIBase: srv.URL, Out: &out})
	if err != nil {
		t.Fatal(err)
	}
	cmds := a.CobraCommands()
	if len(cmds) != 1 {
		t.Fatalf("expected 1 command, got %d", len(cmds))
	}

	if err := run(cmds, "post-note", "--text", "hello"); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != "sent:hello by:7\n" {
		t.Fatalf("unexpected output: %q", got)
	}
}

// A required flag that is missing is a cobra error, never a handler invocation.
func TestRequiredFlagEnforced(t *testing.T) {
	a, err := Load(`microteams.command({name:'x', flags:[{name:'text',type:'string',required:true}], run:()=>{ throw new Error('should not run') }})`,
		Options{Out: &bytes.Buffer{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(a.CobraCommands(), "x"); err == nil {
		t.Fatal("expected an error for the missing required flag")
	}
}

// fs is sandboxed: a normal path resolves inside the root, and a traversal path is clamped back in
// rather than escaping it.
func TestFsSandbox(t *testing.T) {
	root := t.TempDir()
	a, err := Load(`
	  microteams.command({ name: 'w', run: () => {
	    microteams.fs.write('notes/a.txt', 'hi')
	    microteams.print(microteams.fs.read('notes/a.txt'))
	    microteams.print(String(microteams.fs.exists('../escape.txt')))
	    microteams.fs.write('../escape.txt', 'nope')   // must NOT escape root
	  }})
	`, Options{FsRoot: root, Out: &bytes.Buffer{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(a.CobraCommands(), "w"); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(filepath.Join(root, "notes", "a.txt")); err != nil || string(b) != "hi" {
		t.Fatalf("expected file written inside root, got %q err=%v", b, err)
	}
	// The traversal write landed inside the root (clamped), never at the parent.
	parent := filepath.Dir(root)
	if _, err := os.Stat(filepath.Join(parent, "escape.txt")); err == nil {
		t.Fatal("traversal escaped the sandbox root")
	}
	if _, err := os.Stat(filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal("clamped traversal write should be inside the root")
	}
}

// exec captures stdout and the exit code.
func TestExec(t *testing.T) {
	var out bytes.Buffer
	a, err := Load(`
	  microteams.command({ name: 'e', run: () => {
	    const r = microteams.exec('printf', ['ok'])
	    microteams.print('code:' + r.code + ' out:' + r.stdout)
	  }})
	`, Options{Out: &out})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(a.CobraCommands(), "e"); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(out.String()); got != "code:0 out:ok" {
		t.Fatalf("unexpected exec output: %q", got)
	}
}

func run(cmds []*cobra.Command, args ...string) error {
	root := &cobra.Command{Use: "api", SilenceUsage: true, SilenceErrors: true}
	root.AddCommand(cmds...)
	root.SetArgs(args)
	root.SetOut(&bytes.Buffer{})
	root.SetErr(&bytes.Buffer{})
	return root.Execute()
}
