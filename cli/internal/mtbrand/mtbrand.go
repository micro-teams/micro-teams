// Package mtbrand says who this connector is.
//
// The shared connector library keeps every name that differs between products — binary, environment
// prefix, config and runtime directories, service, enrollment and download paths — in one value,
// and defaults it to something generic on purpose. So a product has to declare itself, and this is
// where MicroTeams does.
//
// Getting this wrong fails quietly rather than loudly: the connector would use the wrong config
// file, the wrong tmux socket and the wrong endpoints, and merely look unconfigured. Anything that
// resolves one of those paths — including a test — must call Use first.
package mtbrand

import (
	"github.com/micro-teams/micro-connector/cli/apiauth"
	"github.com/micro-teams/micro-connector/cli/brand"
)

// MicroTeams is this product's identity in the shared library's terms.
var MicroTeams = brand.Brand{
	Name:        "microteams",
	EnvPrefix:   "MICROTEAMS",
	ConfigDir:   "microteams",
	RuntimeDir:  "microteams",
	ServiceName: "microteams",
	EnrollBase:  "/machine/enroll",
	BinaryBase:  "/connector/latest",
}

// Use declares this process to be MicroTeams. Called before anything else runs.
func Use() {
	brand.Current = MicroTeams
	// An agent here is an ordinary user, not a machine wearing the machine's authority: inside a
	// screen the machine's token and the screen's token are exchanged for the agent's own, so it
	// reaches exactly what that user may reach and nothing else. The library speaks as the machine
	// by default, which is right for a product with nobody behind its screens; this is where
	// MicroTeams says it is not that product.
	apiauth.ScreenExchange = &apiauth.ScreenTokenExchange{
		Path:          "/agent/token",
		SessionHeader: "X-Microteams-Session",
		ScreenHeader:  "X-Microteams-Screen",
	}
}
