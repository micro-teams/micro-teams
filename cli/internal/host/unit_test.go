package host

// Which unit a process may write again: only one that starts this binary with this config.

import "testing"

func TestWritesSame(t *testing.T) {
	unit := "[Service]\nExecStart=/home/u/.local/bin/microteams \"run\" \"--config\" \"/home/u/.config/microteams/config.json\"\nUser=u\n"
	const self, cfg = "/home/u/.local/bin/microteams", "/home/u/.config/microteams/config.json"
	for _, tc := range []struct {
		self, cfg, runAs string
		want             bool
	}{
		{self, cfg, "u", true},
		{"/tmp/x/mt", cfg, "u", false},
		{self, "/tmp/t/config.json", "u", false},
		{self, cfg, "bob", false}, // bob under sudo would write User=bob
		{self, cfg, "", false},    // a user unit has no User=
	} {
		if got := writesSame(unit, tc.self, tc.cfg, tc.runAs); got != tc.want {
			t.Errorf("writesSame(%s, %s, %q) = %v", tc.self, tc.cfg, tc.runAs, got)
		}
	}
	userUnit := "[Service]\nExecStart=" + self + " \"run\" \"--config\" \"" + cfg + "\"\n"
	if !writesSame(userUnit, self, cfg, "") || !writesSame(userUnit, self, cfg, "root") {
		t.Error("a unit without User= is what a user, or root itself, writes")
	}
}

func TestServesConfig(t *testing.T) {
	unit := "ExecStart=/bin/microteams \"run\" \"--config\" \"/home/u/c.json\"\n"
	if !servesConfig(unit, "/home/u/c.json") || servesConfig(unit, "/tmp/t/c.json") {
		t.Fatal("servesConfig does not tell configs apart")
	}
}
