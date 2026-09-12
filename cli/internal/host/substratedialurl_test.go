// Regression test for the control link's permanent TLS failure once a deployment's base is https.
//
// Every other test in this package builds its fake origin with httptest.NewServer, which is plain
// HTTP — so cfg.APIBase() is always "http" here and ControlURL() never produces a "wss" URL. That is
// exactly how this bug shipped invisibly: nothing in the suite ever exercised the one case, a real
// deployment behind TLS, where gorilla would dial a second TLS handshake on top of the already-secure
// substrate connection and every control-link attempt would fail with
// `tls: first record does not look like a TLS handshake`, forever, with no reconnect loop able to
// recover from it. See substrateDialURL's own comment in host.go for the mechanism.
package host

import "testing"

func TestSubstrateDialURLDowngradesWssToWs(t *testing.T) {
	got, err := substrateDialURL("wss://microteams.app/mt/machine/link")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	const want = "ws://microteams.app/mt/machine/link"
	if got != want {
		t.Fatalf("substrateDialURL(wss) = %q, want %q", got, want)
	}
}

func TestSubstrateDialURLLeavesWsAlone(t *testing.T) {
	const url = "ws://127.0.0.1:8080/mt/machine/link"
	got, err := substrateDialURL(url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != url {
		t.Fatalf("substrateDialURL(ws) = %q, want unchanged %q", got, url)
	}
}

func TestSubstrateDialURLRejectsGarbage(t *testing.T) {
	if _, err := substrateDialURL("://not a url"); err == nil {
		t.Fatal("expected an error for an unparsable control URL")
	}
}
