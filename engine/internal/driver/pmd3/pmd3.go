// Package pmd3 implements the Driver interface on top of pymobiledevice3.
package pmd3

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
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

	// Cached Python (major, minor) probed once, used to pick the tunnel
	// protocol: pymobiledevice3 defaults `remote tunneld` to the TCP tunnel
	// only on Python 3.13+, and Apple removed the older QUIC tunnel in
	// iOS 18.2+. See tunneldProtocolArgs.
	pyVerOnce sync.Once
	pyMajor   int
	pyMinor   int
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

func init() {
	driver.RegisterWithInfo(driver.ProviderInfo{
		ID:   domain.DriverPmd3,
		Name: "pymobiledevice3",
		Capabilities: []driver.Capability{
			driver.CapabilityTunnelReresolve,
			driver.CapabilityNetworkDevices,
			driver.CapabilityPairing,
		},
	}, New)
}

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

// pythonVersion probes the resolved interpreter's (major, minor) version once
// and caches it. Returns (0, 0) if Python can't be resolved or the probe fails
// — callers treat that as "assume the conservative default".
func (d *Driver) pythonVersion() (int, int) {
	d.pyVerOnce.Do(func() {
		py, err := d.pyCommand()
		if err != nil {
			return
		}
		out, err := execCommand(py, "-c", "import sys;print(sys.version_info[0], sys.version_info[1])").Output()
		if err != nil {
			return
		}
		_, _ = fmt.Sscanf(strings.TrimSpace(string(out)), "%d %d", &d.pyMajor, &d.pyMinor)
	})
	return d.pyMajor, d.pyMinor
}

// pythonSupportsTCPTunnel reports whether the interpreter is new enough for
// pymobiledevice3's TCP RSD tunnel (3.13+). On older interpreters only the
// legacy QUIC tunnel exists — which Apple dropped in iOS 18.2+ — so there the
// daemon is left on its own default (QUIC) as the only thing it can offer.
func (d *Driver) pythonSupportsTCPTunnel() bool {
	major, minor := d.pythonVersion()
	return major > 3 || (major == 3 && minor >= 13)
}
