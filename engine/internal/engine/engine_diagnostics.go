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

// GetDiagnostics collects diagnostics about drivers, certificates, and devices.
func (e *Engine) GetDiagnostics(ctx context.Context) (Diagnostics, error) {
	e.mu.RLock()
	explicit := e.driverCfgBase.BinaryPaths
	e.mu.RUnlock()

	return diagnostics.Collect(ctx, explicit, e.driver())
}
