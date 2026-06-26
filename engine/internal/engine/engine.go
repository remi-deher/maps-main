// Package engine is the orchestrator: it holds the live Status, applies inbound
// actions through the selected Driver, and emits outbound events. It is
// transport-agnostic — the server package wires it to HTTP/WebSocket.
package engine

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/build"
	"github.com/remi-deher/maps-main/engine/internal/cluster"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// EmitFunc publishes an outbound event (type + data) to connected clients.
type EmitFunc func(eventType string, data any)

// Engine is the stateful core.
type Engine struct {
	drv       driver.Driver
	mu        sync.RWMutex
	st        api.Status
	emit      EmitFunc
	cancelSim context.CancelFunc
	simPaused bool
	simMu     sync.Mutex

	// tunnelMu serializes StartTunnel: the boot goroutine and the health
	// monitor's retry/reconnect paths can all call it around the same time,
	// and a second concurrent `ios tunnel start` would race the first one for
	// the tunnel-info HTTP port (28100) and fail to bind it.
	tunnelMu sync.Mutex

	// Anti-drift shield: tracks consecutive REAL_LOCATION reports that drift
	// too far from the spoofed position, to confirm before forcing a re-inject.
	driftFailures   int
	lastReinjection time.Time

	// logService manages the in-memory log buffer.
	logService *LogService

	// driverCfgBase holds the resolved binary paths/manual address from
	// startup (cmd/headless), so SwitchDriver can rebuild a driver.Config at
	// runtime without re-resolving python/go-ios from PATH every time.
	driverCfgBase driver.Config

	// clusterMgr is optional: set via SetClusterManager when cluster mode is
	// enabled, nil otherwise (Status() then omits the Cluster field).
	clusterMgr *cluster.Manager

	// osrmBaseURL is the routing server used for PlayRoute/PlaySequence,
	// editable at runtime from the web interface (SaveSettings). Empty means
	// fall back to defaultOsrmBaseURL().
	osrmBaseURL string

	// store persists settings to disk (SQLite) so they survive a restart
	// instead of resetting to settings.Default() every time. Nil disables
	// persistence (e.g. in tests).
	store settings.Store
}

// SetClusterManager attaches the HA cluster manager so Status() reports its
// state and SaveSettings can push live config changes to it.
func (e *Engine) SetClusterManager(m *cluster.Manager) {
	e.mu.Lock()
	e.clusterMgr = m
	e.mu.Unlock()
}

// ClusterManager returns the attached cluster manager, or nil if cluster mode
// is off (used by the server to wire the peer-to-peer HTTP routes).
func (e *Engine) ClusterManager() *cluster.Manager {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.clusterMgr
}

const maxLogEntries = 200

// Log appends an entry to the in-memory buffer and broadcasts it immediately.
// level is "info" | "warn" | "error"; source identifies what produced it
// (e.g. "simulation", "anti-drift", "ios-client" for client-relayed DEBUG_LOG).
func (e *Engine) Log(level, source, message string) {
	e.LogEvent(level, source, "", "", message, nil)
}

// LogEvent appends a structured entry to the in-memory buffer and broadcasts it.
func (e *Engine) LogEvent(level, source, category, action, message string, fields map[string]string) {
	entry := e.logService.Add(level, source, category, action, message, fields)

	e.mu.RLock()
	emit := e.emit
	e.mu.RUnlock()
	emit(api.EventLog, entry)
}

// GetLogs returns a snapshot of the current log buffer, oldest first.
func (e *Engine) GetLogs() []api.LogEntryPayload {
	return e.logService.Get()
}

// New builds an Engine seeded from settings.
func New(drv driver.Driver, cfg settings.Settings) *Engine {
	// Seed cluster tuning from persisted settings (falling back to the env/
	// built-in defaults the cluster package already holds) so the live values
	// and the broadcast status agree from the first STATUS.
	if cfg.ClusterHeartbeatSeconds > 0 || cfg.ClusterMasterDeadSeconds > 0 || cfg.ClusterPeerTimeoutSeconds > 0 {
		cluster.SetTuning(
			time.Duration(cfg.ClusterHeartbeatSeconds)*time.Second,
			time.Duration(cfg.ClusterMasterDeadSeconds)*time.Second,
			time.Duration(cfg.ClusterPeerTimeoutSeconds)*time.Second,
		)
	}
	hb, dead, peer := cluster.GetTuning()

	osrm := cfg.OsrmBaseURL
	if osrm == "" {
		osrm = defaultOsrmBaseURL()
	}

	return &Engine{
		drv:         drv,
		emit:        func(string, any) {}, // no-op until the server wires OnEvent
		osrmBaseURL: osrm,
		logService:  NewLogService(maxLogEntries),
		st: api.Status{
			State:                     "idle",
			ConnectionType:            domain.ConnUnknown,
			UsbDriver:                 cfg.UsbDriver,
			WifiDriver:                cfg.WifiDriver,
			FallbackEnabled:           cfg.FallbackEnabled,
			NotificationsEnabled:      cfg.NotificationsEnabled,
			DynamicIslandEnabled:      cfg.DynamicIslandEnabled,
			JitterEnabled:             cfg.JitterEnabled,
			Favorites:                 cfg.Favorites,
			RecentHistory:             cfg.RecentHistory,
			Navigation:                domain.Navigation{},
			OsrmBaseURL:               osrm,
			ClusterHeartbeatSeconds:   int(hb / time.Second),
			ClusterMasterDeadSeconds:  int(dead / time.Second),
			ClusterPeerTimeoutSeconds: int(peer / time.Second),
			EnvInfo: api.EnvInfo{
				OS:       runtime.GOOS,
				IsDocker: isDocker(),
				Mode:     "Headless",
				Version:  build.Version,
			},
		},
	}
}

// OnEvent registers the outbound event sink (called by the server).
func (e *Engine) OnEvent(f EmitFunc) {
	e.mu.Lock()
	e.emit = f
	e.mu.Unlock()
}

// statusSnapshotLocked must be called while holding e.mu, typically right
// after mutating e.st. It captures the emit func and a status snapshot, then
// releases the lock, so the caller can emit one or more events afterwards
// without holding e.mu — emit is a callback into client code (the server's
// hub broadcast), and calling it while locked risks a deadlock if it ever
// re-enters the engine.
func (e *Engine) statusSnapshotLocked() (EmitFunc, api.Status) {
	emit, st := e.emit, e.st
	e.mu.Unlock()
	return emit, st
}

// emitStatusLocked is the common case of statusSnapshotLocked: snapshot,
// unlock, and immediately broadcast STATUS. Must be called while holding
// e.mu; unlocks it as a side effect.
func (e *Engine) emitStatusLocked() {
	emit, st := e.statusSnapshotLocked()
	emit(api.EventStatus, st)
}

// SetLocation injects a spoofed position and broadcasts ACK/LOCATION/STATUS.
func (e *Engine) SetLocation(ctx context.Context, lat, lon float64, name string) error {
	return e.injectLocation(ctx, lat, lon, name, true)
}

// simSetLocation injects a position from a running route/patrol simulation
// tick. It skips the history list — recording every tick would flood it with
// a new entry every second instead of the handful of user-initiated jumps.
func (e *Engine) simSetLocation(ctx context.Context, lat, lon float64, name string) error {
	return e.injectLocation(ctx, lat, lon, name, false)
}

func (e *Engine) injectLocation(ctx context.Context, lat, lon float64, name string, recordHistory bool) error {
	if err := e.driver().SetLocation(ctx, lat, lon); err != nil {
		e.LogEvent("error", "engine", "location", "set", fmt.Sprintf("Échec de l'injection de position : %v", err), map[string]string{
			"lat":           fmt.Sprintf("%.6f", lat),
			"lon":           fmt.Sprintf("%.6f", lon),
			"name":          name,
			"recordHistory": fmt.Sprintf("%t", recordHistory),
			"error":         err.Error(),
		})
		return err
	}
	now := nowMs()
	e.mu.Lock()
	e.st.LastInjectedLocation = &api.LocationStamp{Lat: lat, Lon: lon, Name: name, Timestamp: now}
	e.st.State = "running"
	if recordHistory {
		e.pushHistory(lat, lon, name, now)
	}
	emit, st := e.statusSnapshotLocked()

	emit(api.EventAck, api.AckPayload{Lat: lat, Lon: lon, Timestamp: now})
	emit(api.EventLocation, api.LocationPayload{Lat: lat, Lon: lon, Name: name})
	emit(api.EventStatus, st)
	if recordHistory {
		e.LogEvent("info", "engine", "location", "set", fmt.Sprintf("Position injectée : %.6f, %.6f", lat, lon), map[string]string{
			"lat":  fmt.Sprintf("%.6f", lat),
			"lon":  fmt.Sprintf("%.6f", lon),
			"name": name,
		})
	}
	return nil
}

// pushHistory prepends a recent-history entry, skipping consecutive duplicates
// and capping the list at 20 entries. Caller must hold e.mu.
const maxHistoryEntries = 20

func (e *Engine) pushHistory(lat, lon float64, name string, now int64) {
	if len(e.st.RecentHistory) > 0 {
		last := e.st.RecentHistory[0]
		if last.Lat == lat && last.Lon == lon {
			return
		}
	}
	entry := domain.HistoryEntry{Lat: lat, Lon: lon, Name: name, Timestamp: now}
	history := append([]domain.HistoryEntry{entry}, e.st.RecentHistory...)
	if len(history) > maxHistoryEntries {
		history = history[:maxHistoryEntries]
	}
	e.st.RecentHistory = history
}

// ClearLocation removes any spoofed position and broadcasts ACK/STATUS.
func (e *Engine) ClearLocation(ctx context.Context) error {
	if err := e.driver().ClearLocation(ctx); err != nil {
		e.LogEvent("error", "engine", "location", "clear", fmt.Sprintf("Échec de l'arrêt de la simulation GPS : %v", err), map[string]string{"error": err.Error()})
		return err
	}
	e.mu.Lock()
	e.st.LastInjectedLocation = nil
	if e.st.TunnelActive {
		e.st.State = "ready"
	} else {
		e.st.State = "idle"
	}
	emit, st := e.statusSnapshotLocked()

	emit(api.EventAck, api.AckPayload{Timestamp: nowMs()})
	emit(api.EventStatus, st)
	e.LogEvent("info", "engine", "location", "clear", "Simulation GPS arrêtée", nil)
	return nil
}

// Heartbeat records a companion keep-alive and returns a PONG payload.
func (e *Engine) Heartbeat(p api.HeartbeatPayload) api.PongPayload {
	e.mu.Lock()
	e.st.MaintainActive = p.IsMaintaining
	e.st.LastHeartbeat = nowMs()
	e.mu.Unlock()
	return api.PongPayload{Timestamp: nowMs()}
}

// Anti-drift shield tuning, ported from the legacy companion server: a
// generous tolerance (real GPS/network jitter is normal) confirmed over two
// consecutive reports, with a cooldown so a flaky reading can't trigger a
// re-injection storm.
const (
	driftThresholdMeters     = 100.0
	driftConfirmFailures     = 2
	driftReinjectionCooldown = 15 * time.Second
)

// ReportRealLocation records the device's actual GPS position (REAL_LOCATION,
// reported by the companion/iOS side) and, if it has drifted too far from the
// spoofed position for two consecutive reports, forces a re-injection rather
// than letting the device silently fall back to its real position.
func (e *Engine) ReportRealLocation(ctx context.Context, lat, lon float64) {
	e.mu.Lock()
	target := e.st.LastInjectedLocation
	if target == nil {
		target = e.st.LastVerifiedLocation
	}
	if target == nil {
		e.mu.Unlock()
		return
	}

	dist := haversineDistance(domain.LatLon{Lat: lat, Lon: lon}, domain.LatLon{Lat: target.Lat, Lon: target.Lon})
	now := nowMs()
	e.st.LastRealLocation = &api.RealLocation{Lat: lat, Lon: lon, Drift: dist, Timestamp: now}

	reinject := false
	reinjectTarget := *target
	if dist > driftThresholdMeters {
		e.driftFailures++
		if e.driftFailures >= driftConfirmFailures && time.Since(e.lastReinjection) > driftReinjectionCooldown {
			reinject = true
			e.driftFailures = 0
			e.lastReinjection = time.Now()
		}
	} else {
		e.driftFailures = 0
		e.st.LastVerifiedLocation = &api.LocationStamp{Lat: target.Lat, Lon: target.Lon, Name: target.Name, Timestamp: now}
	}
	emit, st := e.statusSnapshotLocked()
	emit(api.EventStatus, st)

	if reinject {
		e.LogEvent("warn", "anti-drift", "location", "reinject", fmt.Sprintf("Dérive de %.0fm confirmée deux fois, ré-injection forcée", dist), map[string]string{
			"distanceMeters": fmt.Sprintf("%.0f", dist),
			"lat":            fmt.Sprintf("%.6f", reinjectTarget.Lat),
			"lon":            fmt.Sprintf("%.6f", reinjectTarget.Lon),
		})
		_ = e.SetLocation(ctx, reinjectTarget.Lat, reinjectTarget.Lon, reinjectTarget.Name)
	}
}

// Status returns a snapshot of the current state.
func (e *Engine) Status() api.Status {
	e.mu.RLock()
	st := e.st
	mgr := e.clusterMgr
	e.mu.RUnlock()

	if mgr != nil {
		info := mgr.Status()
		peers := make([]api.ClusterPeer, len(info.Peers))
		for i, p := range info.Peers {
			peers[i] = api.ClusterPeer{Address: p.Address, Port: p.Port, Online: p.Online, Role: p.Role, Name: p.Name, Discovered: p.Discovered}
		}
		st.Cluster = &api.ClusterInfo{Role: info.Role, Mode: info.Mode, Peers: peers}
	}
	return st
}

// GetDeviceInfo asks the driver for rich device metadata, if it supports it
// (currently go-ios only — see driver.DeviceInfoProvider).
func (e *Engine) GetDeviceInfo(ctx context.Context) (driver.DeviceDetails, error) {
	drv := e.driver()
	provider, ok := drv.(driver.DeviceInfoProvider)
	if !ok {
		return driver.DeviceDetails{}, fmt.Errorf("device info not supported by driver %q", drv.ID())
	}
	return provider.DeviceDetails(ctx)
}

// PairDevice runs the active driver's Lockdown pairing handshake (the
// on-screen "Faire confiance à cet ordinateur ?" prompt) against a
// USB-connected device. This is the prerequisite the iOS 17+ WiFi RSD
// tunnel needs before it can ever come up — see docs/IOS_PAIRING_TUNNEL.md
// and pairingHint, which detects the same missing-pairing condition after a
// failed StartTunnel. Returns an error if the active driver doesn't support
// pairing (none currently lack it, but the capability is optional like
// DeviceInfoProvider/NetworkDeviceLister) or if the CLI call itself fails
// (most commonly: no USB device connected, or the on-screen prompt timed out
// without being accepted).
func (e *Engine) PairDevice(ctx context.Context) error {
	drv := e.driver()
	pairer, ok := drv.(driver.Pairer)
	if !ok {
		return fmt.Errorf("pairing not supported by driver %q", drv.ID())
	}
	if err := pairer.Pair(ctx); err != nil {
		e.LogEvent("error", "tunnel", "pairing", "pair", fmt.Sprintf("Échec du pairing (%s) : %v", drv.ID(), err), map[string]string{
			"driver": string(drv.ID()),
			"error":  err.Error(),
		})
		return err
	}
	e.LogEvent("info", "tunnel", "pairing", "pair", fmt.Sprintf("Pairing réussi (%s)", drv.ID()), map[string]string{
		"driver": string(drv.ID()),
	})
	return nil
}

// ListNetworkDevices surfaces every device the active driver's tunnel daemon
// already auto-discovered (USB or LAN/mDNS), for a device picker in place of a
// free-text manual address. Returns an error if the driver doesn't support it.
func (e *Engine) ListNetworkDevices(ctx context.Context) ([]driver.NetworkDevice, error) {
	drv := e.driver()
	lister, ok := drv.(driver.NetworkDeviceLister)
	if !ok {
		return nil, fmt.Errorf("network device discovery not supported by driver %q", drv.ID())
	}
	return lister.ListNetworkDevices(ctx)
}

// Relance restarts simulation with last injected position
// relanceJitterDeg bounds the per-relance keep-alive offset. ~0.000001° of
// latitude is ~0.11 m, so the ±0.5·relanceJitterDeg range below is roughly
// ±11 cm — a micro-movement, not a real displacement.
const relanceJitterDeg = 0.000002

func (e *Engine) Relance(ctx context.Context) error {
	e.mu.Lock()
	loc := e.st.LastInjectedLocation
	jitter := e.st.JitterEnabled
	e.mu.Unlock()

	if loc == nil {
		return nil
	}
	if !jitter {
		return e.SetLocation(ctx, loc.Lat, loc.Lon, loc.Name)
	}
	// Keep-alive jitter: re-send a coordinate offset by a few centimetres so
	// each relance is a *fresh* fix. iOS (or the tunnel daemon) can drop a spoof
	// that keeps receiving the byte-identical point — notably while the device
	// sleeps — and a tiny change defeats that de-duplication. Jitter around the
	// stable anchor (loc), never the previous jittered point, so the held
	// position can't random-walk away over a long idle session.
	injLat := loc.Lat + (rand.Float64()-0.5)*relanceJitterDeg
	injLon := loc.Lon + (rand.Float64()-0.5)*relanceJitterDeg
	return e.reinjectAnchor(ctx, loc, injLat, injLon)
}

// reinjectAnchor sends injLat/injLon to the driver but records anchor (the true
// held position) as LastInjectedLocation, so relance jitter affects only what
// iOS receives — not the stored state the anti-drift shield and the next
// relance read back. Mirrors injectLocation's emit pattern without touching the
// history list.
func (e *Engine) reinjectAnchor(ctx context.Context, anchor *api.LocationStamp, injLat, injLon float64) error {
	if err := e.driver().SetLocation(ctx, injLat, injLon); err != nil {
		e.LogEvent("error", "engine", "location", "relance", fmt.Sprintf("Échec de la ré-injection : %v", err), map[string]string{
			"lat":   fmt.Sprintf("%.6f", injLat),
			"lon":   fmt.Sprintf("%.6f", injLon),
			"error": err.Error(),
		})
		return err
	}
	now := nowMs()
	e.mu.Lock()
	e.st.LastInjectedLocation = &api.LocationStamp{Lat: anchor.Lat, Lon: anchor.Lon, Name: anchor.Name, Timestamp: now}
	e.st.State = "running"
	emit, st := e.statusSnapshotLocked()
	emit(api.EventStatus, st)
	return nil
}

func nowMs() int64 { return time.Now().UnixMilli() }

func isDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
