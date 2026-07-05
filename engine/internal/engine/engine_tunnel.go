package engine

import (
	"context"
	"fmt"
	"runtime"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// TunnelActive reports whether the driver tunnel is currently up — exposed so
// the cluster manager can answer peer pings without importing this package.
func (e *Engine) TunnelActive() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.st.TunnelActive
}

// SetDriverConfigBase records the resolved driver.Config used to build the
// initial driver, so a later SwitchDriver call can reuse its BinaryPaths/
// ManualAddress instead of starting from a blank Config.
func (e *Engine) SetDriverConfigBase(cfg driver.Config) {
	e.mu.Lock()
	e.driverCfgBase = cfg
	e.mu.Unlock()
}

// driver returns the active driver under e.mu. e.drv is reassigned at runtime
// by SwitchDriver, so every read of it (outside of SwitchDriver itself) must
// go through this accessor instead of touching the field directly.
func (e *Engine) driver() driver.Driver {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.drv
}

// SwitchDriver tears down the current tunnel/driver and rebuilds the engine
// around a different backend (go-ios <-> pymobiledevice3) and/or transport —
// the runtime equivalent of restarting headless with different -driver/
// -transport flags, exposed so a client (tauri-app, iOS) can do it without
// PC access to the machine running the engine.
func (e *Engine) SwitchDriver(ctx context.Context, driverID, transport, wifiAddress, targetUDID string) error {
	e.stopActiveSimulation()

	e.mu.Lock()
	base := e.driverCfgBase
	oldDrv := e.drv
	e.driverGeneration++
	if e.activeStartCancel != nil {
		e.activeStartCancel()
	}
	e.mu.Unlock()

	e.tunnelMu.Lock()
	switchHoldsTunnelMu := true
	defer func() {
		if switchHoldsTunnelMu {
			e.tunnelMu.Unlock()
		}
	}()

	if oldDrv != nil {
		_ = oldDrv.StopTunnel(ctx)
	}

	cfg := base
	wifiAddress = strings.TrimSpace(wifiAddress)
	targetUDID = strings.TrimSpace(targetUDID)
	// Reset selectors that might linger on the startup base config; each switch
	// fully specifies how it wants to connect.
	cfg.ManualAddress = ""
	cfg.TargetUDID = ""
	switch transport {
	case "usb":
		cfg.Transport = driver.TransportUSB
	case "wifi":
		cfg.Transport = driver.TransportWiFi
		// A manual RSD address pins a raw endpoint (no daemon following). Empty
		// keeps the startup -rsd if any, else auto network discovery.
		if wifiAddress != "" {
			cfg.ManualAddress = wifiAddress
		} else if base.ManualAddress != "" {
			cfg.ManualAddress = base.ManualAddress
		}
	default:
		cfg.Transport = driver.TransportAuto
		// In auto mode a target UDID pins one device while keeping the daemon
		// running, so the health monitor can follow it across USB/WiFi.
		cfg.TargetUDID = targetUDID
	}

	newDrv, err := driver.New(domain.DriverID(driverID), cfg)
	if err != nil {
		e.mu.Lock()
		e.activeStartCancel = nil
		if e.st.State == "starting" {
			e.st.State = "idle"
			e.emitStatusLocked()
		} else {
			e.mu.Unlock()
		}
		e.LogEvent("error", "admin", "driver", "switch", fmt.Sprintf("Changement de pilote vers %q échoué : %v", driverID, err), map[string]string{
			"driver": driverID,
			"error":  err.Error(),
		})
		return err
	}

	e.mu.Lock()
	e.drv = newDrv
	e.st.TunnelActive = false
	e.st.RSDAddress = ""
	e.st.RSDPort = 0
	e.st.State = "idle"
	e.st.DeviceInfo = nil
	driverIdVal := domain.DriverID(driverID)
	switch transport {
	case "usb":
		e.st.UsbDriver = driverIdVal
	case "wifi":
		e.st.WifiDriver = driverIdVal
	default:
		e.st.UsbDriver = driverIdVal
		e.st.WifiDriver = driverIdVal
	}
	e.emitStatusLocked()
	e.persist()

	switchFields := map[string]string{
		"driver":    driverID,
		"transport": transport,
	}
	if cfg.TargetUDID != "" {
		switchFields["udid"] = cfg.TargetUDID
	}
	if transport == "wifi" {
		if cfg.ManualAddress != "" {
			switchFields["rsd"] = cfg.ManualAddress
		} else {
			e.LogEvent("warn", "admin", "driver", "switch", "Transport WiFi sans adresse RSD : tentative de découverte réseau par le démon (fournissez une adresse host:port si le device n'est pas trouvé).", switchFields)
		}
	}
	e.LogEvent("info", "admin", "driver", "switch", fmt.Sprintf("Pilote changé pour %s (transport=%s), redémarrage du tunnel...", driverID, transport), switchFields)

	e.tunnelMu.Unlock()
	switchHoldsTunnelMu = false
	if err := e.StartTunnel(ctx); err != nil {
		e.LogEvent("error", "tunnel", "tunnel", "start", fmt.Sprintf("Tunnel non démarré après changement de pilote : %v", err), map[string]string{"error": err.Error()})
		return err
	}
	return nil
}

// StartTunnel brings up the driver tunnel and updates the status.
func (e *Engine) StartTunnel(ctx context.Context) error {
	e.tunnelMu.Lock()
	defer e.tunnelMu.Unlock()

	startCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	e.mu.Lock()
	if e.st.TunnelActive {
		e.mu.Unlock()
		return nil
	}
	drv := e.drv
	generation := e.driverGeneration
	e.activeStartCancel = cancel
	if e.st.State == "idle" {
		e.st.State = "starting"
		e.emitStatusLocked()
	} else {
		e.mu.Unlock()
	}
	defer e.clearActiveStart(generation)
	e.LogEvent("info", "tunnel", "tunnel", "start", fmt.Sprintf("Démarrage du tunnel (%s)", drv.ID()), map[string]string{
		"driver": string(drv.ID()),
	})
	ti, err := drv.StartTunnel(startCtx)
	if err != nil {
		if !e.isCurrentDriverGeneration(generation, drv) {
			return nil
		}
		msg := fmt.Sprintf("Échec du démarrage du tunnel (%s) : %v", drv.ID(), err)
		// On Linux/macOS, creating the RSD IPv6 tunnel interface requires root.
		// Detect permission errors and add a clear remediation hint so the user
		// doesn't have to guess why the tunnel won't start.
		if runtime.GOOS != "windows" && isPermissionError(err) {
			msg += "\n→ Droits insuffisants pour créer le tunnel. Relancez le moteur avec sudo : sudo gpsmock-engine"
		}
		if hint := e.pairingHint(ctx, drv); hint != "" {
			msg += hint
		}
		e.LogEvent("error", "tunnel", "tunnel", "start", msg, map[string]string{
			"driver": string(drv.ID()),
			"error":  err.Error(),
		})
		e.mu.Lock()
		if e.driverGeneration == generation && e.drv == drv && e.st.State == "starting" {
			e.st.State = "idle"
			e.emitStatusLocked()
		} else {
			e.mu.Unlock()
		}
		return err
	}
	if !e.isCurrentDriverGeneration(generation, drv) {
		_ = drv.StopTunnel(context.Background())
		return nil
	}
	e.LogEvent("info", "tunnel", "tunnel", "start", fmt.Sprintf("Tunnel actif (%s) : %s:%d", drv.ID(), ti.Address, ti.Port), map[string]string{
		"driver":  string(drv.ID()),
		"address": ti.Address,
		"port":    fmt.Sprintf("%d", ti.Port),
		"type":    string(ti.Type),
	})
	e.mu.Lock()
	e.st.TunnelActive = true
	e.st.RSDAddress = ti.Address
	e.st.RSDPort = ti.Port
	e.st.ConnectionType = ti.Type
	e.st.DeviceInfo = &domain.DeviceInfo{Name: "iPhone", Driver: drv.ID()}
	if e.st.State == "idle" || e.st.State == "starting" {
		e.st.State = "ready"
	}
	e.emitStatusLocked()
	return nil
}

func (e *Engine) clearActiveStart(generation uint64) {
	e.mu.Lock()
	if e.driverGeneration == generation {
		e.activeStartCancel = nil
	}
	e.mu.Unlock()
}

func (e *Engine) isCurrentDriverGeneration(generation uint64, drv driver.Driver) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.driverGeneration == generation && e.drv == drv
}

// isPermissionError reports whether err looks like an OS-level permission
// denial (EACCES / EPERM or the strings "permission denied" / "operation not
// permitted" that Go wraps them into).
func isPermissionError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "operation not permitted") ||
		strings.Contains(msg, "access denied")
}
