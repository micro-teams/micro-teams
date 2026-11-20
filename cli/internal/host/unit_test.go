package host

// Which unit a process may write again: only one that starts this binary with this config.

import "testing"

func TestRunsThis(t *testing.T) {
	unit := "[Service]\nExecStart=/home/u/.local/bin/microteams \"run\" \"--config\" \"/home/u/.config/microteams/config.json\"\nUser=u\n"
	for _, tc := range []struct {
		self, cfg string
		want      bool
	}{
		{"/home/u/.local/bin/microteams", "/home/u/.config/microteams/config.json", true},
		{"/tmp/x/mt", "/home/u/.config/microteams/config.json", false},
		{"/home/u/.local/bin/microteams", "/tmp/t/config.json", false},
	} {
		if got := runsThis(unit, tc.self, tc.cfg); got != tc.want {
			t.Errorf("runsThis(%s, %s) = %v", tc.self, tc.cfg, got)
		}
	}
}

func TestServesConfig(t *testing.T) {
	unit := "ExecStart=/bin/microteams \"run\" \"--config\" \"/home/u/c.json\"\n"
	if !servesConfig(unit, "/home/u/c.json") || servesConfig(unit, "/tmp/t/c.json") {
		t.Fatal("servesConfig does not tell configs apart")
	}
}
