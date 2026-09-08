package engine

import (
	"context"

	"github.com/remi-deher/maps-main/engine/internal/diagnostics"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

type PairingRecord = diagnostics.PairingRecord
type Diagnostics = diagnostics.Diagnostics

func (e *Engine) pairingHint(ctx context.Context, drv driver.Driver) string {
	return diagnostics.PairingHint(ctx, drv)
}

// GetDiagnostics collects diagnostics about drivers, certificates, and devices,
// including the pre-flight report on whether the device is actually ready to
// receive an injected position.
func (e *Engine) GetDiagnostics(ctx context.Context) (Diagnostics, error) {
	e.mu.RLock()
	explicit := e.driverCfgBase.BinaryPaths
	e.mu.RUnlock()

	drv := e.driver()
	// The probe is an optional driver capability; a backend without it makes the
	// device-state checks report "unknown" rather than dropping them.
	prober, _ := drv.(driver.DeviceStateProbe)
	return diagnostics.CollectWithProbe(ctx, explicit, drv, prober)
}
