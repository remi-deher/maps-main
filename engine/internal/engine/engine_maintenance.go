package engine

import (
	"context"
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/discovery"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// MaintenanceStep is the outcome of one step of RestartServices, reported back
// to the caller so the UI can show exactly what happened rather than a single
// opaque pass/fail.
type MaintenanceStep struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// MaintenanceResult is the full outcome of RestartServices.
type MaintenanceResult struct {
	Steps []MaintenanceStep `json:"steps"`
}

// RestartServices is the "unstick everything" button for the connectivity
// failures that otherwise require the user to manually kill python.exe and
// restart the Bonjour/mDNS service (Windows in particular): it tears down the
// active tunnel, force-kills any pymobiledevice3 process left running
// (including ones this engine instance never launched, e.g. orphaned by a
// previous crash), restarts the OS mDNS responder, and finally brings the
// tunnel back up on the current driver.
//
// Only the final restart step can fail the call: the cleanup steps are
// best-effort (e.g. a "net stop" on an already-stopped service isn't a real
// failure) and their outcome is only reflected in MaintenanceResult.Steps so
// one flaky step doesn't block getting the connection back.
func (e *Engine) RestartServices(ctx context.Context) (MaintenanceResult, error) {
	var result MaintenanceResult
	addStep := func(name string, err error) {
		step := MaintenanceStep{Name: name, OK: err == nil}
		if err != nil {
			step.Error = err.Error()
		}
		result.Steps = append(result.Steps, step)
		level := "info"
		msg := fmt.Sprintf("%s : ok", name)
		fields := map[string]string{"step": name}
		if err != nil {
			level = "warn"
			msg = fmt.Sprintf("%s : %v", name, err)
			fields["error"] = err.Error()
		}
		e.LogEvent(level, "admin", "maintenance", "restart-services", msg, fields)
	}

	e.stopActiveSimulation()

	if drv := e.driver(); drv != nil {
		e.markTunnelLost()
		err := drv.StopTunnel(ctx)
		addStep("Arrêt du tunnel", err)
	}

	addStep("Arrêt des process pymobiledevice3", driver.KillProcessesMatching(ctx, "pymobiledevice3"))
	addStep("Redémarrage du service Bonjour/mDNS", discovery.RestartMDNSService(ctx))

	if err := e.StartTunnel(ctx); err != nil {
		addStep("Redémarrage du tunnel", err)
		return result, err
	}
	addStep("Redémarrage du tunnel", nil)
	return result, nil
}
