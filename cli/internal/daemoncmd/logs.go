package daemoncmd

// `logs [-f] [-n N]`: the connector's own log, wherever this machine keeps it.
//
// "Where are the logs" has no single answer across init systems — journald under systemd, a file
// under sysv, elsewhere under launchd — and the machine that most needs its logs read is a container
// with no journalctl. The connector always writes its own file (internal/hostlog); this is how a
// person reaches it without knowing any of that.

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/micro-teams/microteams/cli/internal/hostlog"
	"github.com/micro-teams/microteams/cli/internal/ui"
)

func logsCmd(cfgPath *string, withConfig func(*cobra.Command) *cobra.Command) *cobra.Command {
	var follow bool
	var lines int
	cmd := withConfig(&cobra.Command{
		Use:   "logs",
		Short: "Show this machine's connector log",
		Long: "Prints the connector's own log file — the same place the reason a connection\n" +
			"fails is written. Works the same on every init system, and inside a container\n" +
			"with no journald.",
		RunE: func(_ *cobra.Command, _ []string) error {
			path := hostlog.Path(*cfgPath)
			if _, err := os.Stat(path); err != nil {
				// Say where we looked: "no logs" with no path sends someone hunting through /var/log.
				ui.Warn("No log yet at %s", path)
				ui.Hint("the log appears once the connector runs — `microteams start`")
				return nil
			}
			if err := tailFile(path, lines); err != nil {
				return err
			}
			if !follow {
				ui.Hint("%s · `microteams logs -f` to follow", path)
				return nil
			}
			return followFile(path)
		},
	})
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "keep printing as new lines arrive")
	cmd.Flags().IntVarP(&lines, "lines", "n", 200, "how many trailing lines to show first")
	return cmd
}

// tailFile prints the last n lines. Reading the whole file is fine: hostlog's rotation bounds it to
// a few megabytes.
func tailFile(path string, n int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	all := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if n > 0 && len(all) > n {
		all = all[len(all)-n:]
	}
	for _, line := range all {
		fmt.Println(line)
	}
	return nil
}

// followFile keeps printing what is appended, and reopens the path when hostlog rotates the file
// out from under it.
func followFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		return err
	}
	buf := make([]byte, 8192)
	for {
		n, err := f.Read(buf)
		if n > 0 {
			os.Stdout.Write(buf[:n])
			continue
		}
		if err != nil && err != io.EOF {
			return err
		}
		time.Sleep(300 * time.Millisecond)
		if info, statErr := os.Stat(path); statErr == nil {
			if here, herr := f.Stat(); herr == nil && !os.SameFile(info, here) {
				reopened, oerr := os.Open(path)
				if oerr != nil {
					continue
				}
				f.Close()
				f = reopened
			}
		}
	}
}
