package pmd3

import (
	"context"
	"os/exec"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const (
	defaultTunnelStartTimeout = 60 * time.Second
	tunnelPollInterval        = 1 * time.Second
)

// StartTunnel mounts the developer image, runs the `remote tunneld` daemon, and
// polls its REST API until the device tunnel is up. With a manual address it
// targets that endpoint directly without a local daemon.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.tunnelStartTimeout <= 0 {
		d.tunnelStartTimeout = defaultTunnelStartTimeout
	}
	return d.mount.Start(ctx, driver.TunnelMountConfig{
		DriverName:    "pmd3",
		StartLabel:    "remote tunneld",
		DaemonLabel:   "remote tunneld",
		ManualAddress: d.manual,
		StartTimeout:  d.tunnelStartTimeout,
		PollInterval:  tunnelPollInterval,
		BeforeStart: func(ctx context.Context) error {
			py, err := d.pyCommand()
			if err != nil {
				return err
			}
			// Best-effort: mount the Developer Disk Image (ignore failures).
			_ = execCommandContext(ctx, py, d.args("mounter", "auto-mount")...).Run()
			return nil
		},
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			py, err := d.pyCommand()
			if err != nil {
				return nil, err
			}
			return execCommand(py, d.args("remote", "tunneld")...), nil
		},
		Resolve: d.queryTunneld,
	})
}

func (d *Driver) StopTunnel(ctx context.Context) error {
	if err := d.stopLocationSession(ctx); err != nil {
		return err
	}
	return d.mount.Stop(ctx)
}

func (d *Driver) CheckHealth(context.Context) bool {
	return d.mount.CheckHealth(3 * time.Second)
}

// ReresolveTunnel re-queries the tunneld REST API and updates the active
// endpoint for the current device, following it across a USB↔WiFi move without
// restarting the daemon (tunneld already monitors both transports concurrently).
func (d *Driver) ReresolveTunnel(ctx context.Context) (driver.TunnelInfo, bool, bool) {
	return driver.ReresolveActiveTunnel(ctx, &d.mount, d)
}
