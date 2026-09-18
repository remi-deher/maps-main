//go:build goiosnative

package goiosnative

import (
	"context"
	"fmt"
	"time"

	"github.com/danielpaulus/go-ios/ios/tunnel"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// StartTunnel brings a tunnel up inside this process.
//
// Same two-step shape as the CLI driver, and for the same reason: a kernel TUN
// adapter needs administrator rights, so the first attempt is the fast path and
// the userspace retry is what makes the engine work on a machine where the user
// never granted them. The difference is that both attempts happen here — no
// agent process, no tunnel-info port, nothing left running if we fail.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if ti, ok := d.Tunnel(); ok {
		return ti, nil
	}

	if d.manual != "" {
		ti, err := driver.ParseManual(d.manual)
		if err != nil {
			return driver.TunnelInfo{}, err
		}
		d.setTunnel(ti)
		return ti, nil
	}

	ti, err := d.startMode(ctx, false)
	// A cancelled caller (shutdown, driver switch) must not have a second tunnel
	// started behind its back.
	if err == nil || ctx.Err() != nil {
		return ti, err
	}
	return d.startMode(ctx, true)
}

// startMode runs one attempt in either kernel-TUN or userspace mode.
func (d *Driver) startMode(ctx context.Context, userspace bool) (driver.TunnelInfo, error) {
	udid := d.resolveUDID()

	pm, err := tunnel.NewPairRecordManager(pairRecordPath())
	if err != nil {
		return driver.TunnelInfo{}, fmt.Errorf("go-ios native: pair record manager: %w", err)
	}

	manager := tunnel.NewTunnelManagerForDevice(pm, userspace, udid, d.basePort)
	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	d.mu.Lock()
	d.manager, d.cancel, d.managerDone = manager, cancel, done
	d.mu.Unlock()

	// The manager only discovers devices and (re)builds tunnels when it is asked
	// to; go-ios's own agent drives it on a one-second ticker, so do the same.
	go func() {
		defer close(done)
		ticker := time.NewTicker(updateInterval)
		defer ticker.Stop()
		for {
			if err := manager.UpdateTunnels(runCtx); err != nil && runCtx.Err() == nil {
				// Transient while a device is absent or still trusting the host;
				// the poll below is what decides whether the attempt succeeded.
				_ = err
			}
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	ti, err := d.awaitTunnel(ctx, manager, udid, userspace)
	if err != nil {
		d.teardown()
		return driver.TunnelInfo{}, err
	}
	d.setTunnel(ti)
	return ti, nil
}

// awaitTunnel polls the manager until it holds a usable tunnel for the device.
func (d *Driver) awaitTunnel(ctx context.Context, manager *tunnel.TunnelManager, udid string, userspace bool) (driver.TunnelInfo, error) {
	label := "kernel-TUN"
	if userspace {
		label = "userspace"
	}
	timeout := d.startTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}

	ticker := time.NewTicker(tunnelPollInterval)
	defer ticker.Stop()
	deadline := time.After(timeout)

	for {
		if ti, ok := findTunnel(manager, udid); ok {
			return ti, nil
		}
		select {
		case <-deadline:
			return driver.TunnelInfo{}, fmt.Errorf("go-ios native: no %s tunnel within %s (device unlocked, trusted and in developer mode?)", label, timeout)
		case <-ctx.Done():
			return driver.TunnelInfo{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

// findTunnel returns the manager's tunnel for udid, or the first usable one when
// no device is pinned.
func findTunnel(manager *tunnel.TunnelManager, udid string) (driver.TunnelInfo, bool) {
	if udid != "" {
		t, err := manager.FindTunnel(udid)
		if err != nil {
			return driver.TunnelInfo{}, false
		}
		return endpointFrom(t)
	}
	tunnels, err := manager.ListTunnels()
	if err != nil {
		return driver.TunnelInfo{}, false
	}
	for _, t := range tunnels {
		if ti, ok := endpointFrom(t); ok {
			return ti, true
		}
	}
	return driver.TunnelInfo{}, false
}

func (d *Driver) StopTunnel(context.Context) error {
	d.teardown()
	return nil
}

// teardown stops the update loop, closes every tunnel the manager holds, and
// forgets the cached device handle. Waiting for the loop to return matters: a
// rescan still in flight would otherwise race the next Start for the same
// device and the same TUN adapter.
func (d *Driver) teardown() {
	d.mu.Lock()
	manager, cancel, done := d.manager, d.cancel, d.managerDone
	d.manager, d.cancel, d.managerDone = nil, nil, nil
	d.info, d.on = driver.TunnelInfo{}, false
	d.hasDev, d.bound = false, driver.TunnelInfo{}
	d.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
	}
	if manager != nil {
		_ = manager.Close()
	}
}

func (d *Driver) setTunnel(ti driver.TunnelInfo) {
	d.mu.Lock()
	d.info, d.on = ti, true
	d.mu.Unlock()
}

// ListNetworkDevices surfaces every tunnel the in-process manager holds.
func (d *Driver) ListNetworkDevices(context.Context) ([]driver.NetworkDevice, error) {
	d.mu.Lock()
	manager := d.manager
	d.mu.Unlock()
	if manager == nil {
		return nil, nil
	}
	tunnels, err := manager.ListTunnels()
	if err != nil {
		return nil, fmt.Errorf("go-ios native: list tunnels: %w", err)
	}
	devices := make([]driver.NetworkDevice, 0, len(tunnels))
	for _, t := range tunnels {
		if t.Address == "" || t.RsdPort <= 0 {
			continue
		}
		dev := driver.NetworkDevice{UDID: t.Udid, Address: t.Address, Port: t.RsdPort}
		if t.UserspaceTUN {
			dev.UserspacePort = t.UserspaceTUNPort
		}
		devices = append(devices, dev)
	}
	return devices, nil
}

// ReresolveTunnel follows a device that moved between USB and WiFi without
// rebuilding the manager: the UDID stays, the RSD address and port change.
// daemonAlive is false only when there is no manager left to ask, which is the
// signal for the health monitor to restart the tunnel outright.
func (d *Driver) ReresolveTunnel(context.Context) (driver.TunnelInfo, bool, bool) {
	d.mu.Lock()
	manager, udid, manual := d.manager, d.udid, d.manual
	d.mu.Unlock()

	if manual != "" {
		// The user pinned this endpoint; there is nothing to follow and nothing
		// to tear down.
		return driver.TunnelInfo{}, false, true
	}
	if manager == nil {
		return driver.TunnelInfo{}, false, false
	}
	ti, ok := findTunnel(manager, udid)
	if !ok {
		return driver.TunnelInfo{}, false, true
	}
	d.setTunnel(ti)
	return ti, true, true
}
