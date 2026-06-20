package driver

import (
	"context"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// notImplemented is a placeholder Driver for backends not yet built. go-ios is
// implemented (package driver/goios, phase 2); pymobiledevice3 lands in phase 3.
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
	// go-ios is registered by package driver/goios. Only pmd3 stays a stub.
	Register(domain.DriverPmd3, func(Config) (Driver, error) {
		return notImplemented{domain.DriverPmd3}, nil
	})
}
