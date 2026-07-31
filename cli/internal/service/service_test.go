// Which service variant an action lands on — the decision T-039 got wrong.
//
// The real thing talks to systemd/launchd, so the decision is separated from the probing and tested
// here with a fake probe: the interesting cases are all about *disagreeing* privilege (a system
// service installed via sudo, acted on by an ordinary user), which is exactly what a machine's real
// service manager would not let a test reproduce.
package service

import "testing"

func TestResolveVariant(t *testing.T) {
	const (
		system = false
		user   = true
	)
	// installed lists the variants this fake machine has.
	probeFor := func(installed ...bool) func(bool) error {
		return func(v bool) error {
			for _, i := range installed {
				if i == v {
					return nil
				}
			}
			return ErrNotInstalled
		}
	}

	cases := []struct {
		name       string
		preferUser bool
		installed  []bool
		wantUser   bool
		wantFound  bool
	}{
		{
			// The bug: `link connect` elevated and installed a SYSTEM service, then an ordinary
			// user ran `link disconnect`. Preferring the user variant must not stop the search —
			// the machine has a system service, so that is what the action belongs to.
			name:       "system service, unprivileged caller",
			preferUser: user,
			installed:  []bool{system},
			wantUser:   system,
			wantFound:  true,
		},
		{
			// The mirror image: a per-user service on a machine where someone runs the command
			// with sudo. Still only one service exists, so still no ambiguity.
			name:       "user service, root caller",
			preferUser: system,
			installed:  []bool{user},
			wantUser:   user,
			wantFound:  true,
		},
		{
			name:       "user service, unprivileged caller",
			preferUser: user,
			installed:  []bool{user},
			wantUser:   user,
			wantFound:  true,
		},
		{
			// Both exist (a machine that was connected both ways at some point): act on the one
			// matching the caller, which is the one they can act on without elevating.
			name:       "both installed prefers the caller's own",
			preferUser: user,
			installed:  []bool{system, user},
			wantUser:   user,
			wantFound:  true,
		},
		{
			// Nothing installed: report that plainly rather than letting the caller stop a
			// service that does not exist and report whatever error its manager produced.
			name:       "neither installed",
			preferUser: user,
			installed:  nil,
			wantUser:   user, // the preference is returned unchanged; only `found` matters
			wantFound:  false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotUser, gotFound := resolveVariant(c.preferUser, probeFor(c.installed...))
			if gotFound != c.wantFound {
				t.Fatalf("found = %v, want %v", gotFound, c.wantFound)
			}
			if gotUser != c.wantUser {
				t.Fatalf("userService = %v, want %v", gotUser, c.wantUser)
			}
		})
	}
}
