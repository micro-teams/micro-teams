package host

// Which config an installed unit runs the connector with.

import "testing"

func TestServesConfig(t *testing.T) {
	unit := "ExecStart=/bin/microteams \"run\" \"--config\" \"/home/u/c.json\"\n"
	if !servesConfig(unit, "/home/u/c.json") || servesConfig(unit, "/tmp/t/c.json") {
		t.Fatal("servesConfig does not tell configs apart")
	}
}
