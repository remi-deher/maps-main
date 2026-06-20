package driver

import (
	"context"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// notImplemented is a placeholder Driver registered for every backend until the
// real go-ios (phase 2) and pymobiledevice3 (phase 3) implementations land.
// Its factory succeeds so the config -> registry -> driver wiring can be
// exercised end to end, but every operation returns ErrNotImplemented.
type notImplemented struct{ id domain.DriverID }

func (d notImplemented) ID() domain.DriverID { return d.id }

func (d notImplemented) StartTunnel(context.Context) (TunnelInfo, error) {
	return TunnelInfo{}, ErrNotImplemented
}
func (d notImplemented) StopTunnel(context.Context) error { return ErrNotImplemented }
func (d notImplemented) SetLocation(context.Context, float64, float64) error {
	return ErrNotImplemented
}
func (d notImplemented) ClearLocation(context.Context) error           { return ErrNotImplemented }
func (d notImplemented) CheckHealth(context.Context) bool              { return false }
func (d notImplemented) ListDevices(context.Context) ([]Device, error) { return nil, ErrNotImplemented }
func (d notImplemented) Tunnel() (TunnelInfo, bool)                    { return TunnelInfo{}, false }

func init() {
	Register(domain.DriverGoIos, func(Config) (Driver, error) {
		return notImplemented{domain.DriverGoIos}, nil
	})
	Register(domain.DriverPmd3, func(Config) (Driver, error) {
		return notImplemented{domain.DriverPmd3}, nil
	})
}
