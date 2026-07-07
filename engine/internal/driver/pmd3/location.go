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

	if d.location != nil && sameEndpoint(d.location.endpoint, ti) {
		return d.location, nil
	}
	if d.location != nil {
		// The old session is bound to an endpoint the tunnel has moved on from
		// (e.g. a reresolve while the device screen is locked, see
		// workerStartTimeout's doc) — it may be mid-connect to a now-dead
		// address and unresponsive to the polite "stop" round-trip. Bound the
		// wait so a stuck worker can't hold locMu (and so every other location
		// operation) for as long as Background() would have let it.
		stopCtx, cancel := context.WithTimeout(ctx, workerStartTimeout)
		_ = d.location.stop(stopCtx)
		cancel()
		d.location = nil
	}

	py, err := d.pyCommand()
	if err != nil {
		return nil, err
	}
	session, err := newLocationSession(ctx, py, ti)
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
