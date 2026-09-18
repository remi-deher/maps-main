// Package goios implements the Driver interface on top of the go-ios CLI.
package goios

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// execCommand/execCommandContext indirect os/exec's package functions so
// tests can substitute a fake child process for the real go-ios binary.
var (
	execCommand        = exec.Command
	execCommandContext = exec.CommandContext
)

// Driver is the go-ios backed implementation.
//
// One Driver is shared by everything that talks to the device: the health
// monitor's 5s loop, the 1Hz simulation ticker and every inbound WebSocket
// action all call into it concurrently. Fields written after construction are
// therefore guarded by mu; everything above it is set once by New and read-only
// afterwards.
type Driver struct {
	binPaths           map[string]string // explicit overrides, for lazy resolution
	lockdownArgs       []string
	manual             string // optional "host:port" RSD endpoint (WiFi transport)
	targetUDID         string // optional: pin resolution (and `tunnel start --udid`) to this device
	tunnelStartTimeout time.Duration
	tunnelInfoURL      string // go-ios tunnel-info HTTP API base ("" => derived from tunnelInfoPort); test seam
	tunnelInfoPort     int    // agent's tunnel-info API port (0 => defaultTunnelInfoPort)

	// mu guards the lazily-resolved binary path and the discovered UDID.
	mu   sync.RWMutex
	bin  string // cached resolved CLI path ("" until resolved)
	udid string

	mount     driver.TunnelMount
	mountGate driver.MountGate
}

// New builds a go-ios Driver. It does NOT fail when the CLI can't be found:
// the engine must still boot (serve the API/UI) so the user can see status and
// pick a driver. A missing binary only matters once an operation needs it.
func New(cfg driver.Config) (driver.Driver, error) {
	bin, _ := platform.ResolveGoIos(cfg.BinaryPaths)
	var lock []string
	if dir := platform.LockdownDir(); dir != "" {
		lock = []string{"--pair-record-path=" + dir}
	}
	timeout := cfg.TunnelStartTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}
	// Pre-seed udid from the target so `tunnel start --udid` and getUDID pin to
	// the chosen device without a `ios list` round-trip.
	return &Driver{
		bin:                bin,
		binPaths:           cfg.BinaryPaths,
		lockdownArgs:       lock,
		manual:             cfg.ManualAddress,
		targetUDID:         cfg.TargetUDID,
		tunnelStartTimeout: timeout,
		tunnelInfoPort:     cfg.DaemonAPIPort,
		udid:               cfg.TargetUDID,
	}, nil
}

// binPath returns the go-ios CLI path, resolving it lazily if New couldn't and
// caching the result so a machine that installs go-ios mid-run stops paying a
// PATH lookup per command.
func (d *Driver) binPath() (string, error) {
	d.mu.RLock()
	bin := d.bin
	d.mu.RUnlock()
	if bin != "" {
		return bin, nil
	}
	resolved, err := platform.ResolveGoIos(d.binPaths)
	if err != nil {
		return "", err
	}
	d.mu.Lock()
	if d.bin == "" {
		d.bin = resolved
	}
	bin = d.bin
	d.mu.Unlock()
	return bin, nil
}

// cachedUDID returns the discovered UDID without triggering a lookup.
func (d *Driver) cachedUDID() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.udid
}

// setUDID records a discovered UDID, unless a target is pinned — in that case
// the pinned value is the only correct answer and must never be replaced.
func (d *Driver) setUDID(udid string) {
	if d.targetUDID != "" || udid == "" {
		return
	}
	d.mu.Lock()
	d.udid = udid
	d.mu.Unlock()
}

func init() {
	driver.RegisterWithInfo(driver.ProviderInfo{
		ID:   domain.DriverGoIos,
		Name: "go-ios",
		Capabilities: []driver.Capability{
			driver.CapabilityTunnelReresolve,
			driver.CapabilityDeviceInfo,
			driver.CapabilityNetworkDevices,
			driver.CapabilityPairing,
		},
	}, New)
}

func (d *Driver) ID() domain.DriverID { return domain.DriverGoIos }

// ListDevices runs `ios list` and returns the discovered UDIDs.
func (d *Driver) ListDevices(ctx context.Context) ([]driver.Device, error) {
	bin, err := d.binPath()
	if err != nil {
		return nil, err
	}
	out, err := execCommandContext(ctx, bin, "list").Output()
	if err != nil {
		return nil, fmt.Errorf("go-ios list: %w", err)
	}
	return parseDeviceList(out), nil
}

// DeviceDetails runs `ios info` against the first detected device and returns
// its lockdown metadata, enriched with the active tunnel address when known.
func (d *Driver) DeviceDetails(ctx context.Context) (driver.DeviceDetails, error) {
	udid, err := d.detailsUDID(ctx)
	if err != nil {
		return driver.DeviceDetails{}, err
	}

	bin, err := d.binPath()
	if err != nil {
		return driver.DeviceDetails{}, err
	}
	out, err := execCommandContext(ctx, bin, "info", "--udid="+udid).Output()
	if err != nil {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios info: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios info: invalid JSON: %w", err)
	}

	details := driver.DeviceDetails{
		UDID:           udid,
		Name:           driver.StringField(raw, "DeviceName"),
		ProductType:    driver.StringField(raw, "ProductType"),
		ProductVersion: driver.StringField(raw, "ProductVersion"),
		SerialNumber:   driver.StringField(raw, "SerialNumber"),
		WifiAddress:    driver.StringField(raw, "WiFiAddress"),
	}
	if ti, ok := d.Tunnel(); ok {
		details.TunnelAddress = ti.Address
	}
	return details, nil
}

// detailsUDID picks which device DeviceDetails should describe. A pinned
// targetUDID always wins: this call used to take devices[0] unconditionally and
// then write it back to d.udid, so on a two-device machine one diagnostics
// request silently re-pointed every subsequent `setlocation --udid=` at the
// wrong iPhone.
func (d *Driver) detailsUDID(ctx context.Context) (string, error) {
	if d.targetUDID != "" {
		return d.targetUDID, nil
	}
	devices, err := d.ListDevices(ctx)
	if err != nil {
		return "", err
	}
	if len(devices) == 0 {
		return "", fmt.Errorf("go-ios: no device detected")
	}
	return devices[0].UDID, nil
}

func (d *Driver) getUDID(ctx context.Context) string {
	if udid := d.cachedUDID(); udid != "" {
		return udid
	}
	devices, err := d.ListDevices(ctx)
	if err == nil && len(devices) > 0 {
		d.setUDID(devices[0].UDID)
	}
	return d.cachedUDID()
}

func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	return d.mount.Current()
}
