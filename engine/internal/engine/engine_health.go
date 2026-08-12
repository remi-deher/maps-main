package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// healthCheckInterval is how often the monitor probes the active tunnel. Short
// enough to follow a USB↔WiFi switch within a few seconds, long enough not to
// spam `ios tunnel ls` / the tunneld REST API.
const healthCheckInterval = 5 * time.Second

// tunnelRetryInterval is the *initial* delay between re-attempts to establish a
// tunnel that has never come up (e.g. no device was connected yet at boot).
// Each attempt blocks the loop for up to the driver's tunnel-start timeout
// (tens of seconds), so this must stay well above healthCheckInterval.
const tunnelRetryInterval = 30 * time.Second

// tunnelRetryMax caps the backoff applied to the retry interval. A device left
// unplugged for hours would otherwise keep triggering a ~45s tunnel attempt
// (plus a `stopagent`/daemon spawn and an error log) every 30s all night; the
// backoff stretches that to one attempt every few minutes instead. Reset to
// tunnelRetryInterval as soon as a tunnel comes up.
const tunnelRetryMax = 5 * time.Minute

// injectFailureThreshold is how many consecutive SetLocation failures mark the
// tunnel as injection-stalled: a tunnel can keep passing its TCP health dial
// while every injection fails (a dead DVT session after a long device sleep),
// and the bare dial would never notice. Past this count the watchdog forces the
// same reresolve/restart recovery a failed dial triggers.
const injectFailureThreshold = 3

// StartHealthMonitor launches the background tunnel watchdog. It runs until ctx
// is cancelled. The loop is a no-op whenever no tunnel is active, so it is safe
// to start once at boot regardless of whether the tunnel is up yet.
func (e *Engine) StartHealthMonitor(ctx context.Context) {
	go e.healthLoop(ctx)
}

// idleKeepaliveInterval is how often a position held at rest is re-asserted to
// keep the tunnel and the pmd3 DVT session warm. Long enough to add negligible
// load, short enough to poke the session before iOS drops a spoof that stopped
// receiving fresh fixes (notably while the device screen is locked). A running
// route/patrol already injects every second, so keepalive only covers the idle
// "position held, nothing moving" case.
const idleKeepaliveInterval = 45 * time.Second

// StartKeepaliveMonitor launches the idle-position keepalive. Safe to start once
// at boot: it no-ops unless a position is held with the tunnel up and no
// simulation running.
func (e *Engine) StartKeepaliveMonitor(ctx context.Context) {
	go e.keepaliveLoop(ctx)
}

func (e *Engine) keepaliveLoop(ctx context.Context) {
	ticker := time.NewTicker(idleKeepaliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		// A running route/patrol injects every tick already — leave it alone.
		if e.simulationActive() {
			continue
		}
		e.mu.RLock()
		hold := e.st.TunnelActive && e.st.LastInjectedLocation != nil && e.st.State == "running"
		e.mu.RUnlock()
		if !hold {
			continue
		}
		// Relance re-sends the held anchor (with keep-alive jitter when enabled) —
		// exactly the "poke the session" needed here. Best-effort: any failure is
		// already logged and surfaces through the injection-health watchdog.
		_ = e.Relance(ctx)
	}
}

// simulationActive reports whether a route/patrol simulation goroutine is
// currently running (so the idle keepalive stands down).
func (e *Engine) simulationActive() bool {
	e.simMu.Lock()
	defer e.simMu.Unlock()
	return e.cancelSim != nil
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
	// Avoid re-logging the injection-stalled warning every tick.
	warnedInjection := false
	// Starts at "now", not the zero value: a zero time.Time would make the
	// very first tick's time.Since(lastRetry) huge, firing an extra StartTunnel
	// just 5s after boot — racing the boot goroutine's own StartTunnel call for
	// the tunnel daemon's HTTP port.
	lastRetry := time.Now()
	// Current backoff between failed retries, grown on each failure and reset
	// once a tunnel is active (see below).
	retryInterval := tunnelRetryInterval

	for {
		select {
		case <-ctx.Done():
			return
		case <-e.resetHealthBackoff:
			lastRetry = time.Time{}
			retryInterval = tunnelRetryInterval
		case <-ticker.C:
		}

		e.mu.RLock()
		active := e.st.TunnelActive
		e.mu.RUnlock()
		if !active {
			warnedSearching = false
			// StartTunnel may have failed at boot (no device connected yet) —
			// nothing else retries that, so do it here, with a growing backoff
			// so an absent device doesn't spawn a tunnel attempt every 30s.
			if time.Since(lastRetry) >= retryInterval {
				lastRetry = time.Now()
				if err := e.StartTunnel(ctx); err != nil {
					retryInterval = min(retryInterval*2, tunnelRetryMax)
				} else {
					retryInterval = tunnelRetryInterval
				}
			}
			continue
		}
		// Tunnel is up: reset the backoff so the next outage retries promptly.
		retryInterval = tunnelRetryInterval

		drv := e.driver()
		hc, ok := drv.(driver.HealthChecker)
		if !ok {
			continue
		}
		start := time.Now()
		reachable := hc.CheckHealth(ctx)
		rtt := time.Since(start)

		// Injection liveness: even a reachable tunnel is unhealthy if every
		// SetLocation has been failing (dead DVT session). Fold that into the
		// recovery trigger below so a stalled tunnel gets re-resolved/restarted
		// instead of looking green forever.
		stalled := e.injectionStalled()
		if reachable && !stalled {
			e.recordHealthRTT(rtt)
			warnedSearching = false
			warnedInjection = false
			continue
		}
		if reachable && stalled && !warnedInjection {
			e.LogEvent("warn", "tunnel", "tunnel", "health", "Tunnel joignable mais injections en échec — re-résolution de l'endpoint…", nil)
			warnedInjection = true
		}

		// Tunnel is unreachable (or injection-stalled) — try to follow the device
		// without a restart.
		rr, ok := drv.(driver.TunnelReresolver)
		if !ok {
			continue
		}
		info, found, daemonAlive := rr.ReresolveTunnel(ctx)
		if found {
			e.applyTunnelUpdate(info)
			warnedSearching = false
			warnedInjection = false
			continue
		}
		if !daemonAlive {
			e.LogEvent("warn", "tunnel", "tunnel", "reconnect", "Tunnel perdu (démon arrêté), redémarrage…", nil)
			// Flip the status to tunnel-down BEFORE restarting: StartTunnel's
			// TunnelActive guard would otherwise see the stale true and return
			// nil without doing anything — leaving this branch to log
			// "redémarrage…" every tick forever while the tunnel never actually
			// comes back (the stuck state that used to require a full engine
			// restart after a long idle period).
			e.markTunnelLost()
			_ = drv.StopTunnel(ctx)
			if err := e.StartTunnel(ctx); err != nil {
				e.LogEvent("error", "tunnel", "tunnel", "reconnect", fmt.Sprintf("Reconnexion échouée : %v", err), map[string]string{"error": err.Error()})
			}
			warnedSearching = false
			continue
		}
		e.setTunnelSearching(true)
		if !warnedSearching {
			e.LogEvent("warn", "tunnel", "tunnel", "reconnect", "Tunnel injoignable, le démon recherche l'appareil (USB/WiFi)…", nil)
			warnedSearching = true
		}
	}
}

// injectionStalled reports whether the active tunnel has accumulated enough
// consecutive SetLocation failures to be treated as unhealthy despite a passing
// TCP dial (see injectFailureThreshold).
func (e *Engine) injectionStalled() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.st.TunnelHealth != nil && e.st.TunnelHealth.ConsecutiveInjectFailures >= injectFailureThreshold
}

// recordHealthRTT stores the latest successful health-dial round-trip and clears
// the searching flag. It doesn't emit STATUS on its own — the value rides along
// on the next natural broadcast (an injection tick, or a health transition) to
// avoid a full status push every 5s just for a latency sample.
func (e *Engine) recordHealthRTT(rtt time.Duration) {
	e.mu.Lock()
	e.updateTunnelHealthLocked(func(th *api.TunnelHealth) {
		th.LastCheckRTTms = rtt.Milliseconds()
		th.Searching = false
	})
	e.mu.Unlock()
}

// setTunnelSearching flags (or clears) that the daemon is up but hunting for the
// device across transports, broadcasting only when the flag actually flips so a
// long device-away stretch doesn't push a STATUS every tick.
func (e *Engine) setTunnelSearching(searching bool) {
	e.mu.Lock()
	if e.st.TunnelHealth != nil && e.st.TunnelHealth.Searching == searching {
		e.mu.Unlock()
		return
	}
	e.updateTunnelHealthLocked(func(th *api.TunnelHealth) { th.Searching = searching })
	e.emitStatusLocked()
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
	e.updateTunnelHealthLocked(func(th *api.TunnelHealth) {
		th.Searching = false
		if changed {
			th.LastReresolveAt = nowMs()
		}
	})
	e.emitStatusLocked() // releases e.mu

	if changed {
		e.LogEvent("info", "tunnel", "tunnel", "reconnect",
			fmt.Sprintf("Appareil suivi → %s:%d (%s)", info.Address, info.Port, info.Type),
			map[string]string{"address": info.Address, "port": fmt.Sprintf("%d", info.Port), "type": string(info.Type)})
	}
}
