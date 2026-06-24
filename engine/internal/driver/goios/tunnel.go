package goios

import (
	"context"
	"os/exec"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const (
	defaultTunnelStartTimeout = 45 * time.Second
	tunnelPollInterval        = 1 * time.Second
)

// StartTunnel launches the `ios tunnel start` daemon and polls `ios tunnel ls`
// until the device tunnel is up. The daemon process is kept running; killing it
// tears down the OS tun adapter.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.tunnelStartTimeout <= 0 {
		d.tunnelStartTimeout = defaultTunnelStartTimeout
	}
	// Try to resolve UDID before starting tunnel
	_ = d.getUDID(ctx)

	return d.mount.Start(ctx, driver.TunnelMountConfig{
		DriverName:    "go-ios",
		StartLabel:    "tunnel start",
		DaemonLabel:   "tunnel",
		ManualAddress: d.manual,
		StartTimeout:  d.tunnelStartTimeout,
		PollInterval:  tunnelPollInterval,
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			bin, err := d.binPath()
			if err != nil {
				return nil, err
			}
			args := append([]string{"tunnel", "start"}, d.lockdownArgs...)
			if d.udid != "" {
				args = append(args, "--udid="+d.udid)
			}
			return execCommand(bin, args...), nil
		},
		Resolve: d.queryTunnel,
	})
}

func (d *Driver) StopTunnel(ctx context.Context) error {
	return d.mount.Stop(ctx)
}

func (d *Driver) CheckHealth(context.Context) bool {
	return d.mount.CheckHealth(3 * time.Second)
}

// ReresolveTunnel re-reads `ios tunnel ls` and updates the active endpoint for
// the current device, following it across a USB↔WiFi move without restarting
// the tunnel daemon.
func (d *Driver) ReresolveTunnel(ctx context.Context) (driver.TunnelInfo, bool, bool) {
	return driver.ReresolveActiveTunnel(ctx, &d.mount, d)
}
