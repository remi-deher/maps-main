// Package engine is the orchestrator: it holds the live Status, applies inbound
// actions through the selected Driver, and emits outbound events. It is
// transport-agnostic — the server package wires it to HTTP/WebSocket.
package engine

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
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

	// Anti-drift shield: tracks consecutive REAL_LOCATION reports that drift
	// too far from the spoofed position, to confirm before forcing a re-inject.
	driftFailures   int
	lastReinjection time.Time

	// In-memory log buffer, broadcast in real time so a client without
	// terminal access (the iOS app, piloting headless over the network) can
	// still see what the engine is doing.
	logMu sync.Mutex
	logs  []api.LogEntryPayload

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
	store *settings.Store
}

// SetStore attaches the settings persistence store. Call once at startup,
// before any mutating action runs.
func (e *Engine) SetStore(store *settings.Store) {
	e.mu.Lock()
	e.store = store
	e.mu.Unlock()
}

// exportSettingsLocked builds a full Settings snapshot from the live status,
// for persistence. Caller must hold e.mu (read or write lock).
func (e *Engine) exportSettingsLocked() settings.Settings {
	cfg := settings.Default()
	cfg.UsbDriver = e.st.UsbDriver
	cfg.WifiDriver = e.st.WifiDriver
	cfg.FallbackEnabled = e.st.FallbackEnabled
	cfg.NotificationsEnabled = e.st.NotificationsEnabled
	cfg.DynamicIslandEnabled = e.st.DynamicIslandEnabled
	cfg.JitterEnabled = e.st.JitterEnabled
	cfg.Favorites = e.st.Favorites
	cfg.RecentHistory = e.st.RecentHistory
	cfg.OsrmBaseURL = e.osrmBaseURL
	cfg.ClusterHeartbeatSeconds = e.st.ClusterHeartbeatSeconds
	cfg.ClusterMasterDeadSeconds = e.st.ClusterMasterDeadSeconds
	cfg.ClusterPeerTimeoutSeconds = e.st.ClusterPeerTimeoutSeconds
	if e.clusterMgr != nil {
		cs := e.clusterMgr.Status()
		cfg.ClusterMode = cs.Mode
		cfg.ClusterSyncCerts = e.clusterMgr.SyncCertsEnabled()
		var nodes []string
		for _, p := range cs.Peers {
			if !p.Discovered {
				nodes = append(nodes, fmt.Sprintf("%s:%d", p.Address, p.Port))
			}
		}
		cfg.ClusterNodes = nodes
	}
	return cfg
}

// persist saves the current settings snapshot to disk. No-op if no store is
// attached. Must NOT be called while holding e.mu.
func (e *Engine) persist() {
	e.mu.RLock()
	store := e.store
	if store == nil {
		e.mu.RUnlock()
		return
	}
	cfg := e.exportSettingsLocked()
	e.mu.RUnlock()
	if err := store.Save(cfg); err != nil {
		e.LogEvent("error", "settings", "settings", "persist", fmt.Sprintf("Échec de la sauvegarde des réglages : %v", err), nil)
	}
}

// osrmURL returns the routing base URL, falling back to the env/default when
// unset. Read under e.mu since SaveSettings can change it at runtime.
func (e *Engine) osrmURL() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.osrmBaseURL == "" {
		return defaultOsrmBaseURL()
	}
	return e.osrmBaseURL
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
func (e *Engine) SwitchDriver(ctx context.Context, driverID, transport string) error {
	e.stopActiveSimulation()

	e.mu.Lock()
	base := e.driverCfgBase
	oldDrv := e.drv
	e.mu.Unlock()

	if oldDrv != nil {
		_ = oldDrv.StopTunnel(ctx)
	}

	cfg := base
	switch transport {
	case "usb":
		cfg.Transport = driver.TransportUSB
	case "wifi":
		cfg.Transport = driver.TransportWiFi
	default:
		cfg.Transport = driver.TransportAuto
	}

	newDrv, err := driver.New(domain.DriverID(driverID), cfg)
	if err != nil {
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
	if transport == "usb" {
		e.st.UsbDriver = driverIdVal
	} else if transport == "wifi" {
		e.st.WifiDriver = driverIdVal
	} else {
		e.st.UsbDriver = driverIdVal
		e.st.WifiDriver = driverIdVal
	}
	e.emitStatusLocked()
	e.persist()

	e.LogEvent("info", "admin", "driver", "switch", fmt.Sprintf("Pilote changé pour %s (transport=%s), redémarrage du tunnel...", driverID, transport), map[string]string{
		"driver":    driverID,
		"transport": transport,
	})

	if err := e.StartTunnel(ctx); err != nil {
		e.LogEvent("error", "tunnel", "tunnel", "start", fmt.Sprintf("Tunnel non démarré après changement de pilote : %v", err), map[string]string{"error": err.Error()})
		return err
	}
	return nil
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
	entry := api.LogEntryPayload{
		Timestamp: nowMs(),
		Level:     normalizeLogLevel(level),
		Source:    source,
		Category:  category,
		Action:    action,
		Message:   message,
		Fields:    fields,
	}

	e.logMu.Lock()
	e.logs = append(e.logs, entry)
	if len(e.logs) > maxLogEntries {
		e.logs = e.logs[len(e.logs)-maxLogEntries:]
	}
	e.logMu.Unlock()

	e.mu.RLock()
	emit := e.emit
	e.mu.RUnlock()
	emit(api.EventLog, entry)
}

func normalizeLogLevel(level string) string {
	switch level {
	case "warn", "error":
		return level
	default:
		return "info"
	}
}

// GetLogs returns a snapshot of the current log buffer, oldest first.
func (e *Engine) GetLogs() []api.LogEntryPayload {
	e.logMu.Lock()
	defer e.logMu.Unlock()
	out := make([]api.LogEntryPayload, len(e.logs))
	copy(out, e.logs)
	return out
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
				Version:  "0.2.0",
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

// StartTunnel brings up the driver tunnel and updates the status.
func (e *Engine) StartTunnel(ctx context.Context) error {
	drv := e.driver()
	e.LogEvent("info", "tunnel", "tunnel", "start", fmt.Sprintf("Démarrage du tunnel (%s)", drv.ID()), map[string]string{
		"driver": string(drv.ID()),
	})
	ti, err := drv.StartTunnel(ctx)
	if err != nil {
		e.LogEvent("error", "tunnel", "tunnel", "start", fmt.Sprintf("Échec du démarrage du tunnel (%s) : %v", drv.ID(), err), map[string]string{
			"driver": string(drv.ID()),
			"error":  err.Error(),
		})
		return err
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
	if e.st.State == "idle" {
		e.st.State = "ready"
	}
	e.emitStatusLocked()
	return nil
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

// Relance restarts simulation with last injected position
func (e *Engine) Relance(ctx context.Context) error {
	e.mu.Lock()
	loc := e.st.LastInjectedLocation
	e.mu.Unlock()

	if loc != nil {
		return e.SetLocation(ctx, loc.Lat, loc.Lon, loc.Name)
	}
	return nil
}

func nowMs() int64 { return time.Now().UnixMilli() }

func isDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
