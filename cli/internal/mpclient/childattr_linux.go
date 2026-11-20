// The client's process attributes on Linux: it receives SIGTERM when the service dies, however it
// dies, so a killed service never leaves a client holding a session for nobody. See mpclient.go.
package mpclient

import "syscall"

func childAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM} }
