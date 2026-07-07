package pmd3

import (
	"context"
	"os/exec"
	"strings"
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
		TimeoutHint:   pmd3TunneldTimeoutHint,
		BeforeStart: func(ctx context.Context) error {
			py, err := d.pyCommand()
			if err != nil {
				return err
			}
			// Best-effort: mount the Developer Disk Image (ignore failures).
			// Bounded: callers like the health monitor's retry loop pass a
			// context without a deadline, and a mounter hung on a locked/
			// sleeping device would otherwise hold the engine's tunnel lock
			// indefinitely.
			mountCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			_ = execCommandContext(mountCtx, py, d.args("mounter", "auto-mount")...).Run()
			return nil
		},
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			py, err := d.pyCommand()
			if err != nil {
				return nil, err
			}
			return execCommand(py, d.args("remote", "tunneld")...), nil
		},
		OutputLineFilter: keepPmd3TunneldOutput,
		Resolve:          d.queryTunneld,
	})
}

const pmd3TunneldTimeoutHint = "le serveur tunneld répond, mais aucun tunnel RSD n'a été publié. Vérifiez que l'iPhone est déverrouillé, approuvé, en mode développeur, et lancez l'application/serveur avec les droits administrateur si l'adaptateur tunnel ne peut pas être créé."

func keepPmd3TunneldOutput(line string) bool {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "INFO:") && strings.Contains(trimmed, `"GET / HTTP/1.1" 200 OK`) {
		return false
	}
	return true
}

func (d *Driver) StopTunnel(ctx context.Context) error {
	// Always tear the daemon down, even when the location worker refused to
	// stop cleanly (a worker stuck on a dead DVT socket after a long device
	// sleep is the common failure here). Returning early on the worker error
	// used to leave the tunneld daemon orphaned AND the mount cache still
	// "on" — so the next StartTunnel returned the stale endpoint immediately
	// and the tunnel never actually restarted.
	workerErr := d.stopLocationSession(ctx)
	if err := d.mount.Stop(ctx); err != nil {
		return err
	}
	return workerErr
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
