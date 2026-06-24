package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// healthCheckInterval is how often the monitor probes the active tunnel. Short
// enough to follow a USB↔WiFi switch within a few seconds, long enough not to
// spam `ios tunnel ls` / the tunneld REST API.
const healthCheckInterval = 5 * time.Second

// tunnelRetryInterval throttles re-attempts to establish a tunnel that has
// never come up (e.g. no device was connected yet at boot). Each attempt
// blocks the loop for up to the driver's tunnel-start timeout (tens of
// seconds), so this must stay well above healthCheckInterval.
const tunnelRetryInterval = 30 * time.Second

// StartHealthMonitor launches the background tunnel watchdog. It runs until ctx
// is cancelled. The loop is a no-op whenever no tunnel is active, so it is safe
// to start once at boot regardless of whether the tunnel is up yet.
func (e *Engine) StartHealthMonitor(ctx context.Context) {
	go e.healthLoop(ctx)
}

// healthLoop transparently keeps the tunnel alive. On each tick, if the active
// tunnel fails its TCP health check it asks the driver to re-resolve the
// endpoint for the same device (UDID) against the daemon's live view — which
// already tracks USB and WiFi concurrently — and updates the status in place.
// Only when the daemon itself is gone does it tear down and restart the tunnel.
func (e *Engine) healthLoop(ctx context.Context) {
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	// Avoid logging "still searching" on every tick while a device is away.
	warnedSearching := false
	var lastRetry time.Time

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		e.mu.RLock()
		active := e.st.TunnelActive
		e.mu.RUnlock()
		if !active {
			warnedSearching = false
			// StartTunnel may have failed at boot (no device connected yet) —
			// nothing else retries that, so do it here, throttled.
			if time.Since(lastRetry) >= tunnelRetryInterval {
				lastRetry = time.Now()
				_ = e.StartTunnel(ctx)
			}
			continue
		}

		drv := e.driver()
		hc, ok := drv.(driver.HealthChecker)
		if !ok {
			continue
		}
		if hc.CheckHealth(ctx) {
			warnedSearching = false
			continue
		}

		// Tunnel is unreachable — try to follow the device without a restart.
		rr, ok := drv.(driver.TunnelReresolver)
		if !ok {
			continue
		}
		info, found, daemonAlive := rr.ReresolveTunnel(ctx)
		if found {
			e.applyTunnelUpdate(info)
			warnedSearching = false
			continue
		}
		if !daemonAlive {
			e.LogEvent("warn", "tunnel", "tunnel", "reconnect", "Tunnel perdu (démon arrêté), redémarrage…", nil)
			_ = drv.StopTunnel(ctx)
			if err := e.StartTunnel(ctx); err != nil {
				e.LogEvent("error", "tunnel", "tunnel", "reconnect", fmt.Sprintf("Reconnexion échouée : %v", err), map[string]string{"error": err.Error()})
			}
			warnedSearching = false
			continue
		}
		if !warnedSearching {
			e.LogEvent("warn", "tunnel", "tunnel", "reconnect", "Tunnel injoignable, le démon recherche l'appareil (USB/WiFi)…", nil)
			warnedSearching = true
		}
	}
}

// applyTunnelUpdate stores a re-resolved endpoint and broadcasts STATUS, logging
// only when the address/port/type actually changed (i.e. the device switched
// transport) to keep the log readable on transient blips.
func (e *Engine) applyTunnelUpdate(info driver.TunnelInfo) {
	e.mu.Lock()
	changed := e.st.RSDAddress != info.Address || e.st.RSDPort != info.Port || e.st.ConnectionType != info.Type
	e.st.TunnelActive = true
	e.st.RSDAddress = info.Address
	e.st.RSDPort = info.Port
	e.st.ConnectionType = info.Type
	e.emitStatusLocked() // releases e.mu

	if changed {
		e.LogEvent("info", "tunnel", "tunnel", "reconnect",
			fmt.Sprintf("Appareil suivi → %s:%d (%s)", info.Address, info.Port, info.Type),
			map[string]string{"address": info.Address, "port": fmt.Sprintf("%d", info.Port), "type": string(info.Type)})
	}
}
