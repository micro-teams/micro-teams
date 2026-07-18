// Package crypto11 is a pure-Go, no-op stand-in for
// github.com/ThalesIgnite/crypto11, swapped in via a go.mod `replace` so the
// `cheese` binary stays CGO-free and cross-compiles cleanly to every target.
//
// Restish (github.com/rest-sh/restish/cli) imports the real crypto11 for
// PKCS#11 hardware-token TLS client certs, which pulls in miekg/pkcs11 (cgo)
// and breaks `CGO_ENABLED=0` cross-compilation. Cheese authenticates with
// bearer tokens and never configures a PKCS#11 device, so that code path is
// never taken — this stub only needs to satisfy the compiler. If a PKCS#11
// device is ever actually configured, Configure returns a clear error rather
// than silently doing nothing.
package crypto11

import (
	"crypto/tls"
	"errors"
)

// Config mirrors the fields Restish sets (path/label/pin).
type Config struct {
	Path       string
	TokenLabel string
	Pin        string
}

// Context is an opaque handle; unused in this stub.
type Context struct{}

var errUnsupported = errors.New("crypto11: PKCS#11 client certs are not supported in this build")

// Configure always fails: this build has no PKCS#11 support.
func Configure(*Config) (*Context, error) { return nil, errUnsupported }

// FindAllPairedCertificates is never reached (Configure fails first).
func (*Context) FindAllPairedCertificates() ([]tls.Certificate, error) { return nil, errUnsupported }
