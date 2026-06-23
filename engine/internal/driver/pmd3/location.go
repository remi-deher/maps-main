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
	return session.set(ctx, lat, lon)
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
		_ = session.stop(context.Background())
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
		_ = d.location.stop(context.Background())
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
	return session.stop(ctx)
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
