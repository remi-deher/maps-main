//go:build goiosnative

// Package goiosnative drives an iOS device through go-ios used as a Go library
// rather than as a command-line tool.
//
// Why it exists: the CLI-backed go-ios driver spawns one `ios setlocation`
// process per injected point. A route plays at 1Hz, so that is a process
// creation, a fresh RSD connection and a full RSD handshake every second —
// on Windows, the dominant cost of playing a route. It also means every answer
// the engine gets is parsed out of CLI output, which is free to change shape
// between go-ios releases.
//
// Here the tunnel manager runs in-process and the device handle (RSD handshake
// included) is established once and reused, so injecting a point is a DVT
// message and nothing else. There is no tunnel agent, no tunnel-info HTTP port
// to share with another engine, and no orphan process to reap on shutdown.
//
// It is behind the `goiosnative` build tag deliberately: go-ios pulls in gvisor,
// quic-go, gopacket and the TUN backends, which is a lot of binary for a driver
// that has not yet been validated against a real device. Build with
// `-tags goiosnative` to get it; the default build links none of it.
package goiosnative

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	goios "github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/tunnel"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

const (
	defaultTunnelStartTimeout = 45 * time.Second
	tunnelPollInterval        = time.Second
	// updateInterval is how often the manager rescans for devices and brings up
	// tunnels for them. One second is what go-ios's own agent uses.
	updateInterval = time.Second
	// defaultBasePort is what userspace listener ports are derived from. It
	// mirrors go-ios's tunnel-info default so a machine already running an agent
	// on it fails loudly rather than silently sharing listeners.
	defaultBasePort = 28100
)

// Driver is the in-process go-ios implementation.
type Driver struct {
	targetUDID   string
	manual       string
	startTimeout time.Duration
	basePort     int

	mu      sync.Mutex
	manager *tunnel.TunnelManager
	cancel  context.CancelFunc
	// managerDone is closed once the manager's update loop has returned, so Stop
	// never leaves a rescan racing the next Start for the same device.
	managerDone chan struct{}
	info        driver.TunnelInfo
	on          bool
	udid        string
	// device is the resolved handle, RSD handshake included, cached so an
	// injection costs a DVT message instead of a fresh handshake. boundTo is the
	// endpoint it was built against: when the device moves, that stops matching
	// and the handle is rebuilt.
	device goios.DeviceEntry
	bound  driver.TunnelInfo
	hasDev bool
}

func init() {
	driver.RegisterWithInfo(driver.ProviderInfo{
		ID:   domain.DriverGoIosNative,
		Name: "go-ios (in-process)",
		Capabilities: []driver.Capability{
			driver.CapabilityTunnelReresolve,
			driver.CapabilityNetworkDevices,
		},
	}, New)
}

// New builds an in-process go-ios Driver. Like the CLI backends it never fails
// for want of a device: the engine must still boot and serve its API so the
// user can see status and pick another driver.
func New(cfg driver.Config) (driver.Driver, error) {
	timeout := cfg.TunnelStartTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}
	basePort := cfg.DaemonAPIPort
	if basePort <= 0 {
		basePort = defaultBasePort
	}
	return &Driver{
		targetUDID:   cfg.TargetUDID,
		manual:       cfg.ManualAddress,
		startTimeout: timeout,
		basePort:     basePort,
		udid:         cfg.TargetUDID,
	}, nil
}

func (d *Driver) ID() domain.DriverID { return domain.DriverGoIosNative }

// ListDevices enumerates what usbmux can see.
func (d *Driver) ListDevices(context.Context) ([]driver.Device, error) {
	list, err := goios.ListDevices()
	if err != nil {
		return nil, fmt.Errorf("go-ios native list: %w", err)
	}
	devices := make([]driver.Device, 0, len(list.DeviceList))
	for _, entry := range list.DeviceList {
		devices = append(devices, driver.Device{
			UDID:   entry.Properties.SerialNumber,
			Source: "usbmux",
		})
	}
	return devices, nil
}

func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.info, d.on
}

// resolveUDID returns the device to work with: the pinned one when set,
// otherwise whatever usbmux reports first.
func (d *Driver) resolveUDID() string {
	// A pinned device is the only correct answer; never let a discovery pass
	// replace it.
	if d.targetUDID != "" {
		return d.targetUDID
	}
	d.mu.Lock()
	udid := d.udid
	d.mu.Unlock()
	if udid != "" {
		return udid
	}
	list, err := goios.ListDevices()
	if err != nil || len(list.DeviceList) == 0 {
		return ""
	}
	udid = list.DeviceList[0].Properties.SerialNumber
	d.mu.Lock()
	if d.udid == "" {
		d.udid = udid
	}
	d.mu.Unlock()
	return udid
}

// pairRecordPath is where go-ios reads and writes tunnel pairing identities.
// The system Lockdown folder when it exists, else the working directory, which
// is what the CLI falls back to when no --pair-record-path is given.
func pairRecordPath() string {
	if dir := platform.LockdownDir(); dir != "" {
		return dir
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func endpointFrom(t tunnel.Tunnel) (driver.TunnelInfo, bool) {
	e, ok := driver.NewTunnelEndpoint(t.Address, t.RsdPort, t.Udid)
	if !ok {
		return driver.TunnelInfo{}, false
	}
	if t.UserspaceTUN {
		e.Info.UserspacePort = t.UserspaceTUNPort
	}
	return e.Info, true
}

// healthDialTarget mirrors the CLI driver's rule: a userspace tunnel has no TUN
// adapter and therefore no route to the device address, so the only socket that
// exists is the local proxy.
func healthDialTarget(ti driver.TunnelInfo) string {
	if ti.UserspacePort > 0 {
		return net.JoinHostPort("127.0.0.1", driver.Itoa(ti.UserspacePort))
	}
	return net.JoinHostPort(ti.Address, driver.Itoa(ti.Port))
}

func (d *Driver) CheckHealth(context.Context) bool {
	ti, ok := d.Tunnel()
	if !ok {
		return false
	}
	conn, err := net.DialTimeout("tcp", healthDialTarget(ti), 3*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
