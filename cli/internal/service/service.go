// Package service runs `microteams` as a cross-platform system service via
// kardianos/service, so `microteams autoconnect enable`, `microteams start`, etc. drive
// it under whatever init system the host uses (systemd, openrc, launchd). The
// work itself — connecting out and hosting server-driven sessions — lives in
// internal/host; this only adapts it to the service.Interface lifecycle.
package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	ksvc "github.com/kardianos/service"

	"github.com/micro-teams/microteams/cli/internal/host"
)

const (
	serviceName = "microteams"
	displayName = "Microteams"
	description = "Connects this machine to Microteams and hosts server-driven sessions."
)

type program struct {
	cfgPath string
	cancel  context.CancelFunc
	done    chan struct{}
}

func (p *program) Start(_ ksvc.Service) error {
	cfg, err := host.LoadConfig(p.cfgPath)
	if err != nil {
		return fmt.Errorf("service: %w", err)
	}
	h, err := host.New(cfg, p.cfgPath)
	if err != nil {
		return fmt.Errorf("service: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.done = make(chan struct{})
	go func() {
		defer close(p.done)
		if err := h.Run(ctx); err != nil && ctx.Err() == nil {
			log.Printf("microteams: host exited: %v", err)
		}
	}()
	return nil
}

func (p *program) Stop(_ ksvc.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	if p.done != nil {
		select {
		case <-p.done:
		case <-time.After(6 * time.Second):
		}
	}
	return nil
}

// New builds the kardianos service bound to the config at cfgPath. When the
// service manager launches the binary it runs `microteams run --config <cfgPath>`.
//
// kardianos adapts to the init system but not to privilege: by default it
// installs a system-level unit, which needs root (and, under systemd, a polkit
// agent to prompt for it). We adapt that ourselves — running as a non-root user
// installs a per-user service instead (systemd `--user`, launchd LaunchAgent),
// which needs no root and no polkit. A machine's config already lives in the
// user's home, so per-user is the natural default for an unprivileged install.
func New(cfgPath string) (ksvc.Service, error) {
	// Default to a per-user service when unprivileged, a system service when root.
	return newService(cfgPath, os.Geteuid() != 0)
}

// newService builds the kardianos service as either a per-user or a system unit.
func newService(cfgPath string, userService bool) (ksvc.Service, error) {
	cfg := &ksvc.Config{
		Name:        serviceName,
		DisplayName: displayName,
		Description: description,
		Arguments:   []string{"run", "--config", cfgPath},
	}
	if userService {
		// A per-user service (systemd --user / launchd LaunchAgent): no root or polkit.
		cfg.Option = ksvc.KeyValue{"UserService": true}
	} else if u := os.Getenv("SUDO_USER"); u != "" && u != "root" {
		// A *system* unit that starts at boot with nobody logged in — but run it AS the
		// invoking user so it uses that user's home (config + private tmux) and gets a
		// real $HOME (restish and tmux both need one; systemd/launchd populate HOME from
		// the account database when User is set).
		cfg.UserName = u
	}
	return ksvc.New(&program{cfgPath: cfgPath}, cfg)
}

// Control runs an install/uninstall/start/stop/restart action against the service.
func Control(cfgPath, action string) error {
	s, err := New(cfgPath)
	if err != nil {
		return err
	}
	return ksvc.Control(s, action)
}

// RunForeground runs the host in the current process (used by `microteams run`).
func RunForeground(cfgPath string) error {
	s, err := New(cfgPath)
	if err != nil {
		return err
	}
	return s.Run()
}

// Status returns a human-readable service status string. It looks for the service under
// both privilege variants — the one matching our own euid first, then the other — so a
// normal-user `microteams status` still reports a *system* service installed via sudo (and
// vice versa). Querying a system unit's state needs no root. "not installed" means
// neither variant exists.
func Status(cfgPath string) (string, error) {
	prefUser := os.Geteuid() != 0
	var lastErr error
	for _, userService := range []bool{prefUser, !prefUser} {
		s, err := newService(cfgPath, userService)
		if err != nil {
			lastErr = err
			continue
		}
		st, err := s.Status()
		if err != nil {
			lastErr = err // most likely ErrNotInstalled for this variant — try the other
			continue
		}
		switch st {
		case ksvc.StatusRunning:
			return "running", nil
		case ksvc.StatusStopped:
			return "stopped", nil
		default:
			return "unknown", nil
		}
	}
	if lastErr != nil {
		return "not installed", nil
	}
	return "unknown", nil
}
