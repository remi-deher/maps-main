package goios

import (
	"context"
	"os/exec"
	"strconv"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const (
	defaultTunnelStartTimeout = 45 * time.Second
	tunnelPollInterval        = 1 * time.Second
)

// StartTunnel launches the `ios tunnel start` daemon and polls the tunnel-info
// API until the device tunnel is up. The daemon process is kept running;
// killing it tears down the tunnel.
//
// It first tries a normal kernel-TUN tunnel (faster, the go-ios default), then
// falls back to a userspace tunnel (`--userspace`) if that fails. Creating the
// kernel TUN adapter needs admin rights (a wintun adapter on Windows, root
// elsewhere); when the user hasn't granted them the kernel attempt fails, but
// the userspace tunnel needs no adapter and can still come up — so the app
// "just works" without elevation, at a small throughput cost.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.tunnelStartTimeout <= 0 {
		d.tunnelStartTimeout = defaultTunnelStartTimeout
	}
	// Try to resolve UDID before starting tunnel
	_ = d.getUDID(ctx)

	ti, err := d.startTunnelMode(ctx, false)
	// A manual address has no daemon to restart in userspace, and a cancelled
	// context (shutdown / SwitchDriver) must not trigger another attempt.
	if err == nil || d.manual != "" || ctx.Err() != nil {
		return ti, err
	}
	return d.startTunnelMode(ctx, true)
}

// startTunnelMode brings up the tunnel in either kernel-TUN (userspace=false) or
// userspace (userspace=true) mode. The two share everything but the --userspace
// flag and the log label.
func (d *Driver) startTunnelMode(ctx context.Context, userspace bool) (driver.TunnelInfo, error) {
	label := "tunnel start"
	if userspace {
		label = "tunnel start (userspace)"
	}
	return d.mount.Start(ctx, driver.TunnelMountConfig{
		DriverName:    "go-ios",
		StartLabel:    label,
		DaemonLabel:   "tunnel",
		ManualAddress: d.manual,
		StartTimeout:  d.tunnelStartTimeout,
		PollInterval:  tunnelPollInterval,
		BeforeStart: func(ctx context.Context) error {
			// Clear any stale tunnel agent so our fresh `tunnel start` owns a
			// clean HTTP API on tunnelInfoPort. A leftover agent (from a prior
			// run, a manual `ios tunnel start`, or our own just-failed kernel-TUN
			// attempt) would otherwise keep serving its own — possibly empty —
			// tunnel list. Best-effort; ignore errors (no agent to stop is the
			// common, fine case). Bounded: callers like the health monitor's
			// retry loop pass a context without a deadline, and a hung stopagent
			// would otherwise hold the engine's tunnel lock indefinitely.
			if bin, err := d.binPath(); err == nil {
				stopCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
				defer cancel()
				_ = execCommandContext(stopCtx, bin, "tunnel", "stopagent").Run()
			}
			return nil
		},
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			bin, err := d.binPath()
			if err != nil {
				return nil, err
			}
			return execCommand(bin, d.tunnelStartArgs(userspace)...), nil
		},
		Resolve: d.queryTunnel,
	})
}

// tunnelStartArgs builds the `ios tunnel start` argument list for the given
// mode. --pair-record-path (in lockdownArgs) and --tunnel-info-port are always
// passed; --userspace is added only for the no-admin userspace fallback.
func (d *Driver) tunnelStartArgs(userspace bool) []string {
	args := append([]string{"tunnel", "start"}, d.lockdownArgs...)
	// Pin the tunnel-info HTTP API port so endpoint.go's queries hit the exact
	// daemon we just launched, not whatever the CLI default is.
	args = append(args, "--tunnel-info-port="+strconv.Itoa(tunnelInfoPort))
	if userspace {
		args = append(args, "--userspace")
	}
	if d.udid != "" {
		args = append(args, "--udid="+d.udid)
	}
	return args
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
