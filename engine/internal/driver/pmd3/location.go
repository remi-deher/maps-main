package pmd3

import (
	"context"
	"fmt"
	"strconv"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// SetLocation injects a spoofed position through a persistent DVT worker. The
// first call opens the DVT connection; later calls reuse it and only send new
// coordinates, avoiding one process per GPX point.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	session, err := d.locationSession(ctx)
	if err != nil {
		return err
	}
	if err := session.set(ctx, lat, lon); err != nil {
		// The worker process may have died or lost connection. Invalidate the
		// session so the next call opens a fresh DVT connection instead of
		// hammering a dead process indefinitely.
		d.locMu.Lock()
		if d.location == session {
			// The roundtrip just failed, so the worker is presumed unresponsive
			// (e.g. the same stale-tunnel hang covered in forceKill's doc) — a
			// polite stop() round-trip would risk hanging just as long.
			session.forceKill()
			d.location = nil
		}
		d.locMu.Unlock()
		return err
	}
	return nil
}

// ClearLocation removes any spoofed position and closes the persistent DVT
// worker. The next SetLocation call will open a fresh session.
func (d *Driver) ClearLocation(ctx context.Context) error {
	session := d.takeLocationSession()

	if session == nil {
		var err error
		session, err = d.locationSession(ctx)
		if err != nil {
			return err
		}
		_ = d.takeLocationSession()
	}
	if err := session.clear(ctx); err != nil {
		session.forceKill()
		return err
	}
	return session.stop(ctx)
}

func (d *Driver) locationSession(ctx context.Context) (*locationSession, error) {
	ti, ok := d.Tunnel()
	if !ok {
		return nil, fmt.Errorf("pmd3: tunnel not started")
	}

	d.locMu.Lock()
	defer d.locMu.Unlock()

	// In userspace mode the worker *is* the tunnel (see userspace.go), so it was
	// created by StartTunnel and there is no endpoint to rebuild it from. A
	// missing session here means the tunnel is gone, not that one can be opened.
	if d.userspace.Load() {
		if d.location == nil {
			return nil, fmt.Errorf("pmd3: userspace tunnel not started")
		}
		return d.location, nil
	}

	if d.location != nil && sameEndpoint(d.location.endpoint, ti) {
		return d.location, nil
	}
	if d.location != nil {
		// Reaching here means the endpoint moved (the equal case returned just
		// above), so this worker is bound to an address the tunnel has left —
		// which happens repeatedly while the device screen is locked and the
		// daemon keeps reassigning. Kill it outright instead of asking it to
		// stop: it has nothing left to flush, and a worker stuck mid-connect on
		// a dead address is exactly the one that won't answer a polite
		// round-trip. That wait was bounded, but the bound is held under locMu,
		// so every injection stalled for it — up to 12s of frozen playback each
		// time the address changed, on a route injecting once a second.
		d.location.forceKill()
		d.location = nil
	}

	py, err := d.pyCommand()
	if err != nil {
		return nil, err
	}
	session, err := newLocationSession(ctx, py, rsdWorkerArgs(ti), ti)
	if err != nil {
		return nil, err
	}
	d.location = session
	return session, nil
}

func (d *Driver) stopLocationSession(ctx context.Context) error {
	session := d.takeLocationSession()
	if session == nil {
		return nil
	}
	// Bound the polite stop the same way locationSession() bounds its own
	// session replacement: a worker stuck mid-DVT-write (dead tunnel after a
	// long device sleep) never reads stdin nor answers, and some callers —
	// the health monitor's daemon-dead restart path in particular — arrive
	// here with a context that has no deadline at all. An unbounded wait
	// there froze the health loop permanently.
	stopCtx, cancel := context.WithTimeout(ctx, workerStartTimeout)
	defer cancel()
	return session.stop(stopCtx)
}

func (d *Driver) takeLocationSession() *locationSession {
	d.locMu.Lock()
	session := d.location
	d.location = nil
	d.locMu.Unlock()
	return session
}

func sameEndpoint(a, b driver.TunnelInfo) bool {
	return a.Address == b.Address && a.Port == b.Port
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func itoa(v int) string { return strconv.Itoa(v) }
