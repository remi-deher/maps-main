package goios

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
	bin, err := d.binPath()
	if err != nil {
		return state
	}

	if enabled, ok := d.developerModeEnabled(ctx, bin); ok {
		state.DeveloperModeEnabled = &enabled
	}
	if mounted, ok := d.developerImageMounted(ctx, bin); ok {
		state.DeveloperImageMounted = &mounted
	}
	return state
}

// developerModeEnabled runs `ios devmode get`. go-ios emits JSON by default; the
// flag's name has moved around between versions, so any boolean field in the
// object is accepted rather than pinning one key.
func (d *Driver) developerModeEnabled(ctx context.Context, bin string) (bool, bool) {
	out, err := d.runProbe(ctx, bin, "devmode", "get")
	if err != nil {
		return false, false
	}
	var fields map[string]any
	if err := json.Unmarshal(out, &fields); err != nil {
		return false, false
	}
	for key, value := range fields {
		if !strings.Contains(strings.ToLower(key), "enabled") {
			continue
		}
		if enabled, ok := value.(bool); ok {
			return enabled, true
		}
	}
	return false, false
}

// developerImageMounted runs `ios image list`. A device with no image mounted
// reports an empty list, which is a definite "no" — unlike a failed command.
func (d *Driver) developerImageMounted(ctx context.Context, bin string) (bool, bool) {
	out, err := d.runProbe(ctx, bin, "image", "list")
	if err != nil {
		return false, false
	}
	// The payload has been both a bare array and an object wrapping one; accept
	// either rather than break on a formatting change.
	var asArray []any
	if err := json.Unmarshal(out, &asArray); err == nil {
		return len(asArray) > 0, true
	}
	var asObject map[string]any
	if err := json.Unmarshal(out, &asObject); err != nil {
		return false, false
	}
	for _, value := range asObject {
		if list, ok := value.([]any); ok {
			return len(list) > 0, true
		}
	}
	return false, false
}

func (d *Driver) runProbe(ctx context.Context, bin string, args ...string) ([]byte, error) {
	if udid := d.udid; udid != "" {
		args = append(args, "--udid="+udid)
	}
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	return execCommandContext(probeCtx, bin, args...).Output()
}
