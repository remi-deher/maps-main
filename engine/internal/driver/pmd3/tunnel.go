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

// StartTunnel mounts the developer image, then brings a tunnel up.
//
// It tries `remote tunneld` first — a shared, kernel-routed tunnel, which is
// what the rest of the driver is built around — and falls back to the no-admin
// in-process tunnel when that fails. tunneld needs administrator rights to
// create its TUN adapter, so on a machine where the user hasn't granted them
// the first attempt fails and the fallback is what makes the app work at all.
// See userspace.go for what the fallback changes.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.tunnelStartTimeout <= 0 {
		d.tunnelStartTimeout = defaultTunnelStartTimeout
	}
	d.userspace.Store(false)

	// The DDI is a prerequisite for every DVT service, location simulation
	// included, and mounting goes over plain USB — so it is done once here for
	// both tunnel modes rather than inside the tunneld path only.
	d.mountDeveloperImage(ctx)

	ti, err := d.startTunneld(ctx)
	// A manual address has no daemon to replace, and a cancelled context
	// (shutdown / SwitchDriver) must not trigger another attempt.
	if err == nil || d.manual != "" || ctx.Err() != nil {
		return ti, err
	}
	return d.startUserspaceTunnel(ctx)
}

// mountDeveloperImage best-effort mounts the Developer Disk Image. Failures are
// ignored: the image may already be mounted, or unavailable offline (iOS 17+
// personalizes it through Apple's signing server), and neither should stop a
// tunnel that might work anyway. Bounded because callers like the health
// monitor's retry loop pass a context without a deadline, and a mounter hung on
// a locked/sleeping device would otherwise hold the engine's tunnel lock.
func (d *Driver) mountDeveloperImage(ctx context.Context) {
	py, err := d.pyCommand()
	if err != nil {
		return
	}
	mountCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_ = execCommandContext(mountCtx, py, d.args("mounter", "auto-mount")...).Run()
}

func (d *Driver) startTunneld(ctx context.Context) (driver.TunnelInfo, error) {
	return d.mount.Start(ctx, driver.TunnelMountConfig{
		DriverName:    "pmd3",
		StartLabel:    "remote tunneld",
		DaemonLabel:   "remote tunneld",
		ManualAddress: d.manual,
		StartTimeout:  d.tunnelStartTimeout,
		PollInterval:  tunnelPollInterval,
		TimeoutHint:   pmd3TunneldTimeoutHint,
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			py, err := d.pyCommand()
			if err != nil {
				return nil, err
			}
			return execCommand(py, d.args(d.tunneldArgs()...)...), nil
		},
		OutputLineFilter: keepPmd3TunneldOutput,
		Resolve:          d.queryTunneld,
	})
}

// tunneldArgs builds the `remote tunneld` invocation. It forces the TCP tunnel
// on Python 3.13+ (see pythonSupportsTCPTunnel): pymobiledevice3 otherwise
// defaults to QUIC, which Apple removed in iOS 18.2+ — a QUIC daemon then
// publishes no usable RSD tunnel for a modern device and the start silently
// times out. On < 3.13 TCP isn't available, so we leave the daemon on its
// default (QUIC) as the only transport it can offer.
func (d *Driver) tunneldArgs() []string {
	args := []string{"remote", "tunneld"}
	if d.pythonSupportsTCPTunnel() {
		args = append(args, "--protocol", "tcp")
	}
	return args
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
	// In userspace mode the worker was the tunnel, so stopping it above already
	// tore the tunnel down; clearing the flag keeps a later StartTunnel from
	// taking the userspace paths before it has decided again.
	d.userspace.Store(false)
	if err := d.mount.Stop(ctx); err != nil {
		return err
	}
	return workerErr
}

func (d *Driver) CheckHealth(context.Context) bool {
	if d.userspace.Load() {
		return d.checkUserspaceHealth(3 * time.Second)
	}
	return d.mount.CheckHealth(3 * time.Second)
}

// ReresolveTunnel re-queries the tunneld REST API and updates the active
// endpoint for the current device, following it across a USB↔WiFi move without
// restarting the daemon (tunneld already monitors both transports concurrently).
func (d *Driver) ReresolveTunnel(ctx context.Context) (driver.TunnelInfo, bool, bool) {
	if d.userspace.Load() {
		// Nothing to re-resolve: the worker owns the tunnel, and its address is
		// in-process, so it never moves. A worker that stopped answering means
		// the tunnel is gone for good — report it as dead so the health monitor
		// restarts it rather than waiting for an endpoint that will never come.
		if !d.checkUserspaceHealth(3 * time.Second) {
			return driver.TunnelInfo{}, false, false
		}
		ti, ok := d.mount.Current()
		return ti, ok, true
	}
	return driver.ReresolveActiveTunnel(ctx, &d.mount, d)
}
