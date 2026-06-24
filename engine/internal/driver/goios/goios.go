// Package goios implements the Driver interface on top of the go-ios CLI.
package goios

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
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
type Driver struct {
	bin                string            // cached resolved CLI path ("" until resolved)
	binPaths           map[string]string // explicit overrides, for lazy resolution
	lockdownArgs       []string
	manual             string // optional "host:port" RSD endpoint (WiFi transport)
	targetUDID         string // optional: pin resolution (and `tunnel start --udid`) to this device
	tunnelStartTimeout time.Duration
	tunnelInfoURL      string // go-ios tunnel-info HTTP API base ("" => defaultTunnelInfoURL); overridable in tests
	udid               string

	mount driver.TunnelMount
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
	return &Driver{bin: bin, binPaths: cfg.BinaryPaths, lockdownArgs: lock, manual: cfg.ManualAddress, targetUDID: cfg.TargetUDID, tunnelStartTimeout: timeout, udid: cfg.TargetUDID}, nil
}

// binPath returns the go-ios CLI path, resolving it lazily if New couldn't.
func (d *Driver) binPath() (string, error) {
	if d.bin != "" {
		return d.bin, nil
	}
	return platform.ResolveGoIos(d.binPaths)
}

func init() { driver.Register(domain.DriverGoIos, New) }

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
	devices, err := d.ListDevices(ctx)
	if err != nil {
		return driver.DeviceDetails{}, err
	}
	if len(devices) == 0 {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios: no device detected")
	}
	udid := devices[0].UDID

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

	d.udid = udid

	details := driver.DeviceDetails{
		UDID:           udid,
		Name:           stringField(raw, "DeviceName"),
		ProductType:    stringField(raw, "ProductType"),
		ProductVersion: stringField(raw, "ProductVersion"),
		SerialNumber:   stringField(raw, "SerialNumber"),
		WifiAddress:    stringField(raw, "WiFiAddress"),
	}
	if ti, ok := d.Tunnel(); ok {
		details.TunnelAddress = ti.Address
	}
	return details, nil
}

func (d *Driver) getUDID(ctx context.Context) string {
	if d.udid != "" {
		return d.udid
	}
	devices, err := d.ListDevices(ctx)
	if err == nil && len(devices) > 0 {
		d.udid = devices[0].UDID
	}
	return d.udid
}

func stringField(raw map[string]any, key string) string {
	s, _ := raw[key].(string)
	return s
}

func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	return d.mount.Current()
}
