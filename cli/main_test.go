package main

// The command tree a person sees: the flat verbs in the help, and the commands only programs run
// (`run` for the service manager, `acp-screen` inside an agent's screen) hidden from it.

import (
	"bytes"
	"slices"
	"strings"
	"testing"
)

func TestVisibleCommands(t *testing.T) {
	root, _ := newRoot()
	var visible []string
	for _, c := range root.Commands() {
		if !c.Hidden {
			visible = append(visible, c.Name())
		}
	}
	want := []string{"api", "config", "disable", "enable", "login", "logout", "logs", "restart",
		"start", "status", "stop", "uninstall", "update"}
	slices.Sort(visible)
	if !slices.Equal(visible, want) {
		t.Fatalf("visible commands = %v, want %v", visible, want)
	}
}

func TestHiddenCommandsResolve(t *testing.T) {
	root, _ := newRoot()
	for _, path := range [][]string{
		{"acp-screen"}, {"run"},
		{"config", "proxy", "set"},
	} {
		c, _, err := root.Find(path)
		if err != nil || c.Name() != path[len(path)-1] {
			t.Errorf("%v does not resolve: %v", path, err)
			continue
		}
		if path[0] != "config" && !c.Hidden && (c.Parent() == root || !c.Parent().Hidden) {
			t.Errorf("%v is shown in help", path)
		}
	}
}

func TestHelpListsNoAlias(t *testing.T) {
	root, _ := newRoot()
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetArgs([]string{"--help"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"acp-screen", "run "} {
		if strings.Contains(out.String(), "  "+name) {
			t.Errorf("help lists %q:\n%s", name, out.String())
		}
	}
}
