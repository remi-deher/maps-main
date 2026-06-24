// Package pmd3 implements the Driver interface on top of pymobiledevice3.
package pmd3

import (
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// execCommand/execCommandContext indirect os/exec's package functions so
// tests can substitute a fake child process for the real python interpreter.
var (
	execCommand        = exec.Command
	execCommandContext = exec.CommandContext
)

// Driver is the pymobiledevice3-backed implementation.
type Driver struct {
	py                 string            // cached python executable ("" until resolved)
	base               []string          // base args, e.g. ["-m","pymobiledevice3"]
	binPaths           map[string]string // explicit overrides, for lazy resolution
	manual             string            // optional "host:port" RSD endpoint (WiFi transport)
	targetUDID         string            // optional: pin resolution to this device's tunnel
	tunnelStartTimeout time.Duration
	tunneldURL         string // tunneld REST API base ("" => defaultTunneldURL); overridable in tests

	mount    driver.TunnelMount
	location *locationSession
	locMu    sync.Mutex
}

// New builds a pmd3 Driver. It does NOT fail when Python can't be found: the
// engine still boots, and a missing interpreter only surfaces when needed.
func New(cfg driver.Config) (driver.Driver, error) {
	py, _, _ := platform.Pmd3Command(cfg.BinaryPaths)
	timeout := cfg.TunnelStartTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}
	return &Driver{
		py:                 py,
		base:               []string{"-m", "pymobiledevice3"},
		binPaths:           cfg.BinaryPaths,
		manual:             cfg.ManualAddress,
		targetUDID:         cfg.TargetUDID,
		tunnelStartTimeout: timeout,
	}, nil
}

// pyCommand returns the Python executable, resolving it lazily if New couldn't.
func (d *Driver) pyCommand() (string, error) {
	if d.py != "" {
		return d.py, nil
	}
	py, _, err := platform.Pmd3Command(d.binPaths)
	return py, err
}

func init() { driver.Register(domain.DriverPmd3, New) }

func (d *Driver) ID() domain.DriverID { return domain.DriverPmd3 }

// ListDevices runs `usbmux list` and returns the discovered devices.
func (d *Driver) ListDevices(ctx context.Context) ([]driver.Device, error) {
	py, err := d.pyCommand()
	if err != nil {
		return nil, err
	}
	out, err := execCommandContext(ctx, py, d.args("usbmux", "list")...).Output()
	if err != nil {
		return nil, fmt.Errorf("pmd3 usbmux list: %w", err)
	}
	return parseDeviceList(out), nil
}

func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	return d.mount.Current()
}

func (d *Driver) args(extra ...string) []string {
	return append(append([]string{}, d.base...), extra...)
}
