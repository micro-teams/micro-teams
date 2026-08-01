// Package brand holds the handful of names that make this connector one product rather than
// another: what the binary is called, what its environment variables are prefixed with, where its
// config and runtime files live, and which endpoints it enrolls against.
//
// They are collected here because they are the entire difference. Everything else in this connector
// — driving a terminal, hosting an applet, keeping a screen alive, updating itself — is the same
// work regardless of whose product it is, and a literal "microteams" buried in a path is what turns
// shared code into a fork.
//
// One value per process. A connector is one product for its whole life, so this is a constant that
// happens to be set at startup rather than a parameter threaded through every call. Set it once,
// before anything else runs; changing it later is a programming error, not a feature.
package brand

import (
	"os"
	"path/filepath"
	"strconv"
)

type Brand struct {
	// Name is the binary's name, and the prefix on everything it says to a terminal.
	Name string
	// EnvPrefix prefixes the environment variables this connector reads and injects into screens
	// (e.g. "MICROTEAMS" -> MICROTEAMS_API, MICROTEAMS_TOKEN, MICROTEAMS_SCREEN).
	EnvPrefix string
	// ConfigDir is the directory under the user's config home holding config.json.
	ConfigDir string
	// RuntimeDir names the per-user runtime directory that holds the private tmux socket. It must
	// differ between products: two connectors sharing it would each see the other's sessions, and
	// tearing one down would take the other's screens with it.
	RuntimeDir string
	// ServiceName is the system service's name.
	ServiceName string
	// EnrollBase is the control plane's enrollment path, e.g. "/machine/enroll", under which
	// "/start" and "/poll" live.
	EnrollBase string
	// BinaryBase is where a published binary lives on the control plane's origin, e.g.
	// "/connector/latest", followed by "/<os>-<arch>/<Name>".
	BinaryBase string
}

// MicroTeams is the brand this repository builds.
var MicroTeams = Brand{
	Name:        "microteams",
	EnvPrefix:   "MICROTEAMS",
	ConfigDir:   "microteams",
	RuntimeDir:  "microteams",
	ServiceName: "microteams",
	EnrollBase:  "/machine/enroll",
	BinaryBase:  "/connector/latest",
}

// Current is the brand this process is. Set it at startup if it is not MicroTeams.
var Current = MicroTeams

// Env returns a full environment variable name, e.g. Env("TOKEN") -> "MICROTEAMS_TOKEN".
func (b Brand) Env(name string) string { return b.EnvPrefix + "_" + name }

// Getenv reads one of this brand's environment variables.
func (b Brand) Getenv(name string) string { return os.Getenv(b.Env(name)) }

// RuntimePath is the per-user runtime directory: a STABLE path, not a fresh temp dir. The tmux
// server outlives the connector process, so a restarted or self-updated connector must arrive back
// at the same socket to find the sessions it left behind.
func (b Brand) RuntimePath() string {
	return filepath.Join(os.TempDir(), b.RuntimeDir+"-"+strconv.Itoa(os.Getuid()))
}
