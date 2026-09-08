package pmd3

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// probeTimeout bounds each device query. These run inside a diagnostics
// request, so a locked or sleeping device must make the report late, not make
// it hang.
const probeTimeout = 10 * time.Second

// ProbeDeviceState reports whether the device is in a state where DVT services
// can work at all: Developer Mode on, Developer Disk Image mounted. Both are
// left unknown (nil) rather than guessed when the query fails, since "we
// couldn't ask" and "the answer is no" call for very different advice.
func (d *Driver) ProbeDeviceState(ctx context.Context) driver.DeviceState {
	var state driver.DeviceState
	py, err := d.pyCommand()
	if err != nil {
		return state
	}

	if enabled, ok := d.developerModeEnabled(ctx, py); ok {
		state.DeveloperModeEnabled = &enabled
	}
	if mounted, ok := d.developerImageMounted(ctx, py); ok {
		state.DeveloperImageMounted = &mounted
	}
	return state
}

// developerModeEnabled runs `amfi developer-mode-status`, which prints a bare
// JSON boolean.
func (d *Driver) developerModeEnabled(ctx context.Context, py string) (bool, bool) {
	out, err := d.runProbe(ctx, py, "amfi", "developer-mode-status")
	if err != nil {
		return false, false
	}
	trimmed := strings.TrimSpace(string(out))
	switch strings.ToLower(trimmed) {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	var enabled bool
	if err := json.Unmarshal([]byte(trimmed), &enabled); err != nil {
		return false, false
	}
	return enabled, true
}

// developerImageMounted runs `mounter list`. An empty list is a definite "no",
// unlike a command that failed outright.
func (d *Driver) developerImageMounted(ctx context.Context, py string) (bool, bool) {
	out, err := d.runProbe(ctx, py, "mounter", "list")
	if err != nil {
		return false, false
	}
	var images []any
	if err := json.Unmarshal(out, &images); err != nil {
		return false, false
	}
	return len(images) > 0, true
}

func (d *Driver) runProbe(ctx context.Context, py string, args ...string) ([]byte, error) {
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	return execCommandContext(probeCtx, py, d.args(args...)...).Output()
}
