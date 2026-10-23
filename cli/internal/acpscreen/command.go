package acpscreen

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// Command is `microteams acp-screen --session <id> -- <agent command…>`.
func Command(version string) *cobra.Command {
	var session, operatorFile, wireLog, model string
	c := &cobra.Command{
		Use:   "acp-screen --session <id> -- <agent command> [args…]",
		Short: "Run an ACP agent (e.g. dsh --profile acp) with a terminal transcript, inside an agent screen",
		Long: "Starts an agent that speaks ACP (the Agent Client Protocol) over stdio and shows its work\n" +
			"as a readable transcript, with a status line at the bottom. Each message typed or pasted\n" +
			"into this terminal becomes one prompt; Ctrl-C cancels the current one. The ACP session is\n" +
			"remembered under --session, so running it again with the same id resumes it.\n\n" +
			"The operator prompt for a new session is read from --operator-prompt-file, or from\n" +
			"$MICROTEAMS_OPERATOR_PROMPT.",
		Args: cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if session == "" {
				return fmt.Errorf("--session is required")
			}
			if _, err := exec.LookPath(args[0]); err != nil {
				fmt.Fprintf(os.Stdout, "%s not found on PATH. ", args[0])
				if args[0] == "dsh" {
					fmt.Fprint(os.Stdout, "Install DeepSeek Harness with: npm i -g @deepseek-ai/dsh")
				}
				fmt.Fprintln(os.Stdout)
				return err
			}
			operator := os.Getenv("MICROTEAMS_OPERATOR_PROMPT")
			if operatorFile != "" {
				b, err := os.ReadFile(operatorFile)
				if err != nil {
					return err
				}
				operator = string(b)
			}
			cwd, _ := os.Getwd()

			cmd := exec.Command(args[0], args[1:]...)
			stdin, err := cmd.StdinPipe()
			if err != nil {
				return err
			}
			stdout, err := cmd.StdoutPipe()
			if err != nil {
				return err
			}
			stderr := &tailBuffer{max: 16 * 1024}
			cmd.Stderr = stderr
			if err := cmd.Start(); err != nil {
				return err
			}

			var log io.Writer
			if wireLog != "" {
				f, err := os.OpenFile(wireLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
				if err == nil {
					defer f.Close()
					log = f
				}
			}

			width := 100
			in := io.Reader(os.Stdin)
			if fd := int(os.Stdin.Fd()); term.IsTerminal(fd) {
				if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil {
					width = w
				}
				if old, err := term.MakeRaw(fd); err == nil {
					defer term.Restore(fd, old)
				}
			}

			return Run(Options{
				Session:        session,
				Cwd:            cwd,
				OperatorPrompt: operator,
				StateDir:       filepath.Join(stateHome(), "microteams", "acp"),
				In:             in,
				Out:            os.Stdout,
				Width:          width,
				WireLog:        log,
				Version:        version,
				Model:          model,
			}, Agent{
				Stdin:  stdin,
				Stdout: stdout,
				Wait: func() string {
					err := cmd.Wait()
					if err == nil {
						return "status 0"
					}
					return strings.TrimPrefix(err.Error(), "exit ")
				},
				Stderr: stderr.String,
			})
		},
	}
	c.Flags().StringVar(&session, "session", "", "this screen's session id; the ACP session is stored and resumed under it")
	c.Flags().StringVar(&operatorFile, "operator-prompt-file", "", "file holding the operator prompt for a new session")
	c.Flags().StringVar(&model, "model", "", "select this model (id or display name) once the session is open")
	c.Flags().StringVar(&wireLog, "wire-log", "", "append the full JSON-RPC stream to this file (debugging)")
	return c
}

func stateHome() string {
	if d := os.Getenv("XDG_STATE_HOME"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "state")
}

// tailBuffer keeps the last max bytes written to it.
type tailBuffer struct {
	mu  sync.Mutex
	max int
	b   []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > t.max {
		t.b = t.b[len(t.b)-t.max:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.b)
}
