// Package auth implements the client half of the device login flow: this machine
// asks the server to start an authorization, shows the user a link to open, and
// polls until a human approves it — at which point the server hands back a
// durable credential representing this device. How the user actually
// authenticates on that link is entirely the server's business; the client only
// starts, waits, and stores the result.
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Start asks the server to begin a device authorization. deviceName is the
// human label proposed for this machine (may be empty).
// NOTE: field tags and endpoint paths are aligned to the micro-agent-teams backend, which
// serves enrollment under /machine/enroll/... with camelCase JSON, and calls the thing being
// enrolled a *machine* (it hosts screens; an agent is only one thing that may run on one).
// This is the only divergence from the upstream frozen CLI.
type startResp struct {
	Code       string `json:"code"`
	ApproveURL string `json:"approveUrl"`
	Interval   int    `json:"interval"`
}

// pollResp is the answer to one poll: pending until a human approves, then the
// durable token and the server-assigned machine id.
type pollResp struct {
	Status    string `json:"status"` // "pending" | "approved" | "denied"
	Token     string `json:"token"`
	MachineID string `json:"machineId"`
}

// Result is what a completed login yields.
type Result struct {
	Token     string
	MachineID string
}

// Login runs the full device flow against base. It calls show(approveURL) once
// the link is known, then blocks polling until approval, denial, or ctx ends.
func Login(ctx context.Context, base string, show func(approveURL string)) (*Result, error) {
	base = strings.TrimRight(base, "/")
	var sr startResp
	if err := postJSON(ctx, base+"/machine/enroll/start", map[string]string{}, &sr); err != nil {
		return nil, fmt.Errorf("auth: start: %w", err)
	}
	if sr.Code == "" || sr.ApproveURL == "" {
		return nil, fmt.Errorf("auth: server returned an incomplete start response")
	}
	show(sr.ApproveURL)

	interval := time.Duration(sr.Interval) * time.Second
	if interval <= 0 {
		interval = 2 * time.Second
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-tick.C:
			var pr pollResp
			if err := postJSON(ctx, base+"/machine/enroll/poll",
				map[string]string{"code": sr.Code}, &pr); err != nil {
				return nil, fmt.Errorf("auth: poll: %w", err)
			}
			switch pr.Status {
			case "approved":
				if pr.Token == "" {
					return nil, fmt.Errorf("auth: approved but no token returned")
				}
				return &Result{Token: pr.Token, MachineID: pr.MachineID}, nil
			case "denied":
				return nil, fmt.Errorf("auth: the request was denied")
			}
			// otherwise pending — keep waiting.
		}
	}
}

func newJSONRequest(ctx context.Context, url string, body any) (*http.Request, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func postJSON(ctx context.Context, url string, body, out any) error {
	req, err := newJSONRequest(ctx, url, body)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("server returned %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
