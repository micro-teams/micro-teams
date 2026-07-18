// Package update fetches a fresh `microteams` binary from the server and swaps it in
// place. It carries the platform→artifact mapping the installer uses
// (frontend/scripts/build-connector.mjs + install.sh), downloads the matching
// binary next to the running executable, verifies it is a real, runnable binary,
// and atomically replaces the current one. Handing the process off to the new
// binary (so a running service keeps its tmux) is the caller's job; this package
// only produces a verified, in-place replacement.
package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// platformDir maps a GOOS/GOARCH pair to the `<os>-<arch>` directory the server
// actually serves artifacts under — `linux-amd64` / `linux-arm64` / `darwin-amd64`
// / `darwin-arm64`. This MUST match install.sh's `target` and the installer route's
// accepted targets (api/routes/installer.py `_TARGET_RE`), which are Go-style
// (amd64/arm64), NOT uname-style (x86_64/aarch64). Kept pure so it is unit-testable.
func platformDir(goos, goarch string) (string, error) {
	switch goos {
	case "linux", "darwin":
	default:
		return "", fmt.Errorf("update: unsupported OS %q (microteams runs on Linux and macOS)", goos)
	}
	switch goarch {
	case "amd64", "arm64":
	default:
		return "", fmt.Errorf("update: unsupported arch %q (microteams ships amd64 and arm64)", goarch)
	}
	return goos + "-" + goarch, nil
}

// PlatformDir returns the artifact directory for the running platform.
func PlatformDir() (string, error) { return platformDir(runtime.GOOS, runtime.GOARCH) }

// binaryURL is the published location of the `microteams` binary for dir, at the
// server's *origin* (scheme://host of base) — the connector artifacts live at
// `<origin>/connector/latest/<os>-<arch>/microteams`, at the origin root, never under
// the `/api` edge prefix (see CLAUDE.md §"Backend is always the frontend origin").
func binaryURL(base, dir string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("update: bad base %q: %v", base, err)
	}
	origin := u.Scheme + "://" + u.Host
	return origin + "/connector/latest/" + dir + "/microteams", nil
}

// Fetch downloads the current platform's `microteams` binary from base's origin into a
// temp file in the SAME directory as the running executable (so a later os.Rename
// onto the executable is atomic), makes it executable, and verifies it is a real,
// runnable binary by executing `<temp> --version` under a timeout. On any failure
// the temp file is removed and an error is returned — the caller must keep running
// the current binary unchanged. On success it returns the temp file path; the
// caller replaces the executable with Replace and hands off.
func Fetch(ctx context.Context, base string) (string, error) {
	dir, err := PlatformDir()
	if err != nil {
		return "", err
	}
	rawURL, err := binaryURL(base, dir)
	if err != nil {
		return "", err
	}
	self, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("update: locate self: %w", err)
	}
	self, _ = filepath.EvalSymlinks(self)
	destDir := filepath.Dir(self)

	tmp, err := os.CreateTemp(destDir, ".microteams-update-*")
	if err != nil {
		return "", fmt.Errorf("update: temp file: %w", err)
	}
	tmpPath := tmp.Name()
	cleanup := func() { tmp.Close(); os.Remove(tmpPath) }

	dlCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("update: request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("update: download %s: %w", rawURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		cleanup()
		return "", fmt.Errorf("update: download %s: HTTP %d", rawURL, resp.StatusCode)
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		cleanup()
		return "", fmt.Errorf("update: write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("update: close: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("update: chmod: %w", err)
	}
	if err := verify(ctx, tmpPath); err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	return tmpPath, nil
}

// verify runs `<path> --version` under a short timeout to prove the freshly
// downloaded file is a real, runnable binary for this platform (a truncated
// download, an HTML error page, or a wrong-arch build would fail here) before we
// let it replace the live executable.
func verify(ctx context.Context, path string) error {
	vctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(vctx, path, "--version")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("update: downloaded binary failed verification (%s --version): %w", path, err)
	}
	return nil
}

// Replace atomically moves tmpPath onto selfPath. Both are in the same directory
// (Fetch guarantees it), so the rename is atomic; replacing a running
// executable's path is fine on Linux/macOS (the old inode stays mapped until the
// process exits).
func Replace(tmpPath, selfPath string) error {
	if err := os.Rename(tmpPath, selfPath); err != nil {
		return fmt.Errorf("update: replace %s: %w", selfPath, err)
	}
	return nil
}

// SelfPath resolves the path of the running executable (symlinks evaluated).
func SelfPath() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		return resolved, nil
	}
	return self, nil
}
