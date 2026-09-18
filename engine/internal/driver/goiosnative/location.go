//go:build goiosnative

package goiosnative

import (
	"context"
	"fmt"

	goios "github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/simlocation"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// SetLocation injects a spoofed position over the in-process tunnel.
//
// The device handle — RSD connection and handshake included — is built once and
// reused. That is the whole point of this backend: the CLI driver pays a process
// spawn plus a full handshake for every point of a route playing at 1Hz.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	device, err := d.deviceHandle(ctx)
	if err != nil {
		return err
	}
	if err := simlocation.SetLocation(device, driver.Ftoa(lat), driver.Ftoa(lon)); err != nil {
		d.invalidateDevice()
		return fmt.Errorf("go-ios native setlocation: %w", err)
	}
	return nil
}

// ClearLocation removes any spoofed position.
func (d *Driver) ClearLocation(ctx context.Context) error {
	device, err := d.deviceHandle(ctx)
	if err != nil {
		return err
	}
	if err := simlocation.ResetLocation(device); err != nil {
		d.invalidateDevice()
		return fmt.Errorf("go-ios native resetlocation: %w", err)
	}
	return nil
}

// deviceHandle returns a device bound to the current endpoint, rebuilding it
// when the tunnel has moved out from under the cached one (a device switching
// between USB and WiFi gets a new RSD address and port, same UDID).
func (d *Driver) deviceHandle(context.Context) (goios.DeviceEntry, error) {
	ti, ok := d.Tunnel()
	if !ok {
		return goios.DeviceEntry{}, fmt.Errorf("go-ios native: tunnel not started")
	}

	d.mu.Lock()
	if d.hasDev && d.bound.Address == ti.Address && d.bound.Port == ti.Port {
		device := d.device
		d.mu.Unlock()
		return device, nil
	}
	udid := d.udid
	d.mu.Unlock()

	device, err := buildDevice(udid, ti)
	if err != nil {
		return goios.DeviceEntry{}, err
	}

	d.mu.Lock()
	d.device, d.bound, d.hasDev = device, ti, true
	d.mu.Unlock()
	return device, nil
}

// buildDevice performs the RSD handshake and returns a device handle able to
// reach DVT services over the tunnel.
func buildDevice(udid string, ti driver.TunnelInfo) (goios.DeviceEntry, error) {
	base, err := goios.GetDevice(udid)
	if err != nil {
		return goios.DeviceEntry{}, fmt.Errorf("go-ios native: device %q not found: %w", udid, err)
	}
	if ti.UserspacePort > 0 {
		// No TUN adapter exists in userspace mode; the device is reached through
		// a local TCP proxy, and go-ios needs to be told so explicitly.
		base.UserspaceTUN = true
		base.UserspaceTUNHost = "127.0.0.1"
		base.UserspaceTUNPort = ti.UserspacePort
	}

	rsdService, err := goios.NewWithAddrPortDevice(ti.Address, ti.Port, base)
	if err != nil {
		return goios.DeviceEntry{}, fmt.Errorf("go-ios native: connect to RSD %s:%d: %w", ti.Address, ti.Port, err)
	}
	defer func() { _ = rsdService.Close() }()

	// An unchecked handshake leaves an empty service list, and every later
	// lookup then misreports as "service not available in RSD" rather than as
	// the connection problem it is.
	provider, err := rsdService.Handshake()
	if err != nil {
		return goios.DeviceEntry{}, fmt.Errorf("go-ios native: RSD handshake %s:%d: %w", ti.Address, ti.Port, err)
	}

	device, err := goios.GetDeviceWithAddress(udid, ti.Address, provider)
	if err != nil {
		return goios.DeviceEntry{}, fmt.Errorf("go-ios native: resolve device over RSD: %w", err)
	}
	device.UserspaceTUN = base.UserspaceTUN
	device.UserspaceTUNHost = base.UserspaceTUNHost
	device.UserspaceTUNPort = base.UserspaceTUNPort
	return device, nil
}

// invalidateDevice drops the cached handle so the next call rebuilds it. Called
// when a DVT operation fails: the tunnel may have moved, or the DVT session may
// be dead, and both are fixed by a fresh handshake rather than by retrying on a
// handle that is already stale.
func (d *Driver) invalidateDevice() {
	d.mu.Lock()
	d.hasDev = false
	d.mu.Unlock()
}
