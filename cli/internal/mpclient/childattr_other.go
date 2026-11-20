//go:build !linux

// The client's process attributes elsewhere: macOS has no parent-death signal, so a client left
// behind by a killed service is ended by the next service instead (Supervisor.endPrevious). See
// mpclient.go.
package mpclient

import "syscall"

func childAttr() *syscall.SysProcAttr { return nil }
