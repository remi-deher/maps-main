package pmd3

import (
	"context"
	"fmt"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// The no-admin path.
//
// `remote tunneld` creates a kernel TUN adapter, which needs administrator
// rights — the single biggest obstacle to "it just works" on a fresh Windows
// machine. pymobiledevice3 also offers a tunnel built on a pure-Python network
// stack that needs no adapter and no elevation (iOS 17.4+), but with one
// consequence that shapes everything here: its docstring is explicit that
// "the device address is in-process only, reachable only from this process's
// userspace stack". A separate location worker could never reach a tunnel this
// engine opened for it.
//
// So in userspace mode the ownership inverts: instead of the driver opening a
// tunnel and handing its endpoint to a worker, the *worker* opens the tunnel
// and keeps it for the lifetime of its own DVT session. The worker is then both
// the tunnel and the injector, which is also why there is exactly one — PyTCP's
// stack is a process-global singleton and refuses a second concurrent tunnel.

// userspaceEndpoint is the synthetic TunnelInfo recorded for an in-process
// tunnel. It has no dialable address by construction; the address string exists
// so status displays and logs have something honest to show.
var userspaceEndpoint = driver.TunnelInfo{
	Address: "in-process",
	Port:    0,
	Type:    domain.ConnUSB,
}

// IsUserspace reports whether the active tunnel is the no-admin in-process one.
func (d *Driver) IsUserspace() bool { return d.userspace.Load() }

// startUserspaceTunnel brings the tunnel up inside a location worker and
// registers it as the driver's active tunnel. Any previous worker is discarded
// first: PyTCP allows only one userspace tunnel per process, and two workers
// would fight over the device besides.
func (d *Driver) startUserspaceTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	py, err := d.pyCommand()
	if err != nil {
		return driver.TunnelInfo{}, err
	}

	// Drop the old session before starting the new one, so the two never hold a
	// userspace tunnel at the same time.
	if old := d.takeLocationSession(); old != nil {
		old.forceKill()
	}

	session, err := newLocationSession(ctx, py, d.userspaceWorkerArgs(), userspaceEndpoint)
	if err != nil {
		return driver.TunnelInfo{}, fmt.Errorf("pmd3 userspace tunnel: %w", err)
	}

	d.locMu.Lock()
	d.location = session
	d.locMu.Unlock()
	d.userspace.Store(true)

	info := userspaceEndpoint
	info.Since = time.Now()
	// cmd is nil here, so the mount treats this like a manual address: nothing
	// to restart or re-query on its own. Teardown goes through the worker.
	d.mount.SetActive(info, d.targetUDID)
	return info, nil
}

// userspaceWorkerArgs builds the worker invocation for the in-process tunnel.
func (d *Driver) userspaceWorkerArgs() []string {
	args := []string{"--userspace"}
	if d.targetUDID != "" {
		args = append(args, "--udid", d.targetUDID)
	}
	return args
}

// rsdWorkerArgs builds the worker invocation for a tunnel that already exists
// (tunneld, or a manual address).
func rsdWorkerArgs(endpoint driver.TunnelInfo) []string {
	return []string{"--rsd", endpoint.Address, itoa(endpoint.Port)}
}

// checkUserspaceHealth pings the worker holding the in-process tunnel. It is
// the userspace counterpart of TunnelMount.CheckHealth's TCP dial, which cannot
// work here: there is no socket to connect to.
func (d *Driver) checkUserspaceHealth(timeout time.Duration) bool {
	d.locMu.Lock()
	session := d.location
	d.locMu.Unlock()
	if session == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return session.ping(ctx) == nil
}
