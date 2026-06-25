// Package enroller writes iOS pairing records (received from ios-enroller
// over HTTP) into the host's Lockdown directory, so go-ios/pymobiledevice3
// on this machine can use them without a USB pairing prompt.
package enroller

import (
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// ErrInvalidInput wraps validation/decoding failures caused by the caller's
// request (missing fields, malformed base64, unsafe UDID) — as opposed to
// host/infrastructure failures (missing Lockdown dir, write failure). HTTP
// callers can use errors.Is(err, ErrInvalidInput) to pick a 400 vs 500.
var ErrInvalidInput = errors.New("invalid enrollment input")

// Request is the decoded enrollment payload for one device.
type Request struct {
	UDID         string
	DeviceRecord string // base64-encoded pairing record (plist)
}

var udidPattern = regexp.MustCompile(`^[A-Fa-f0-9-]+$`)

// Validate reports whether the request has the minimum fields needed to
// enroll a device.
func (r Request) Validate() error {
	if r.UDID == "" || r.DeviceRecord == "" {
		return fmt.Errorf("%w: udid or deviceRecord missing", ErrInvalidInput)
	}
	// UDID is used as a single filename component; reject path/meta characters.
	if strings.Contains(r.UDID, "/") || strings.Contains(r.UDID, "\\") || strings.Contains(r.UDID, "..") || !udidPattern.MatchString(r.UDID) {
		return fmt.Errorf("%w: invalid udid", ErrInvalidInput)
	}
	return nil
}

// Enroll decodes req.DeviceRecord and writes it as <udid>.plist into the
// host's Lockdown directory, creating the directory if needed. It returns
// the path written to.
func Enroll(req Request) (string, error) {
	dir := platform.LockdownDir()
	if dir == "" {
		return "", fmt.Errorf("lockdown directory not found on host")
	}

	// Make sure the directory exists (create it if missing, best effort).
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Warn("enroller: failed to create lockdown dir", "dir", dir, "error", err)
	}

	content, err := base64.StdEncoding.DecodeString(req.DeviceRecord)
	if err != nil {
		return "", fmt.Errorf("%w: invalid base64 in deviceRecord: %v", ErrInvalidInput, err)
	}

	destPath := filepath.Join(dir, req.UDID+".plist")
	if err := os.WriteFile(destPath, content, 0o600); err != nil {
		return "", fmt.Errorf("failed to write pairing file: %w", err)
	}

	slog.Info("enroller: successfully enrolled device", "udid", req.UDID, "path", destPath)
	return destPath, nil
}
