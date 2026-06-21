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
		e.Log("error", "admin", fmt.Sprintf("Changement de pilote vers %q échoué : %v", driverID, err))
		return err
	}

	e.mu.Lock()
	e.drv = newDrv
	e.st.TunnelActive = false
	e.st.RSDAddress = ""
	e.st.RSDPort = 0
	e.st.State = "idle"
	e.st.DeviceInfo = nil
	emit, st := e.emit, e.st
	e.mu.Unlock()
	emit(api.EventStatus, st)
	e.Log("info", "admin", fmt.Sprintf("Pilote changé pour %s (transport=%s), redémarrage du tunnel...", driverID, transport))

	if err := e.StartTunnel(ctx); err != nil {
		e.Log("error", "tunnel", fmt.Sprintf("Tunnel non démarré après changement de pilote : %v", err))
		return err
	}
	return nil
}

const maxLogEntries = 200

// Log appends an entry to the in-memory buffer and broadcasts it immediately.
// level is "info" | "warn" | "error"; source identifies what produced it
// (e.g. "simulation", "anti-drift", "ios-client" for client-relayed DEBUG_LOG).
func (e *Engine) Log(level, source, message string) {
	entry := api.LogEntryPayload{Timestamp: nowMs(), Level: level, Source: source, Message: message}

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
	return &Engine{
		drv:  drv,
		emit: func(string, any) {}, // no-op until the server wires OnEvent
		st: api.Status{
			State:                "idle",
			ConnectionType:       domain.ConnUnknown,
			UsbDriver:            cfg.UsbDriver,
			WifiDriver:           cfg.WifiDriver,
			FallbackEnabled:      cfg.FallbackEnabled,
			NotificationsEnabled: cfg.NotificationsEnabled,
			DynamicIslandEnabled: cfg.DynamicIslandEnabled,
			Favorites:            cfg.Favorites,
			RecentHistory:        cfg.RecentHistory,
			Navigation:           domain.Navigation{},
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

// StartTunnel brings up the driver tunnel and updates the status.
func (e *Engine) StartTunnel(ctx context.Context) error {
	drv := e.driver()
	ti, err := drv.StartTunnel(ctx)
	if err != nil {
		e.Log("error", "tunnel", fmt.Sprintf("Échec du démarrage du tunnel (%s) : %v", drv.ID(), err))
		return err
	}
	e.Log("info", "tunnel", fmt.Sprintf("Tunnel actif (%s) : %s:%d", drv.ID(), ti.Address, ti.Port))
	e.mu.Lock()
	e.st.TunnelActive = true
	e.st.RSDAddress = ti.Address
	e.st.RSDPort = ti.Port
	e.st.ConnectionType = ti.Type
	e.st.DeviceInfo = &domain.DeviceInfo{Name: "iPhone", Driver: drv.ID()}
	if e.st.State == "idle" {
		e.st.State = "ready"
	}
	emit, st := e.emit, e.st
	e.mu.Unlock()

	emit(api.EventStatus, st)
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
		return err
	}
	now := nowMs()
	e.mu.Lock()
	e.st.LastInjectedLocation = &api.LocationStamp{Lat: lat, Lon: lon, Name: name, Timestamp: now}
	e.st.State = "running"
	if recordHistory {
		e.pushHistory(lat, lon, name, now)
	}
	emit, st := e.emit, e.st
	e.mu.Unlock()

	emit(api.EventAck, api.AckPayload{Lat: lat, Lon: lon, Timestamp: now})
	emit(api.EventLocation, api.LocationPayload{Lat: lat, Lon: lon, Name: name})
	emit(api.EventStatus, st)
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
		return err
	}
	e.mu.Lock()
	e.st.LastInjectedLocation = nil
	if e.st.TunnelActive {
		e.st.State = "ready"
	} else {
		e.st.State = "idle"
	}
	emit, st := e.emit, e.st
	e.mu.Unlock()

	emit(api.EventAck, api.AckPayload{Timestamp: nowMs()})
	emit(api.EventStatus, st)
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
	emit, st := e.emit, e.st
	e.mu.Unlock()

	emit(api.EventStatus, st)

	if reinject {
		e.Log("warn", "anti-drift", fmt.Sprintf("Dérive de %.0fm confirmée deux fois, ré-injection forcée", dist))
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

// stopActiveSimulation terminates any running routing/navigation or patrol goroutines
func (e *Engine) stopActiveSimulation() {
	e.simMu.Lock()
	defer e.simMu.Unlock()
	if e.cancelSim != nil {
		e.cancelSim()
		e.cancelSim = nil
	}
	e.simPaused = false
}

// StopRoute is the explicit STOP_ROUTE action: same effect as starting a new
// simulation (cancels the running one), but exposed as its own action so a
// client can stop without having to issue another PLAY_* to do it.
func (e *Engine) StopRoute(ctx context.Context) error {
	e.stopActiveSimulation()
	e.mu.Lock()
	e.st.State = "ready"
	e.st.Navigation.Status = nil
	e.st.Navigation.Progress = nil
	e.st.CurrentSequencePreview = nil
	emit, st := e.emit, e.st
	e.mu.Unlock()
	emit(api.EventStatus, st)
	e.Log("info", "simulation", "Trajet arrêté")
	return nil
}

// PauseRoute freezes the active simulation in place: the goroutine keeps
// running (its index/state is preserved) but skips ticks until resumed —
// unlike StopRoute/a new PLAY_*, nothing is lost, so ResumeRoute continues
// from the exact same point instead of restarting.
func (e *Engine) PauseRoute(ctx context.Context) error {
	e.simMu.Lock()
	hasSim := e.cancelSim != nil
	if hasSim {
		e.simPaused = true
	}
	e.simMu.Unlock()
	if !hasSim {
		return nil
	}

	e.mu.Lock()
	e.st.State = "paused"
	if e.st.Navigation.Status != nil {
		e.st.Navigation.Status.State = "paused"
	}
	emit, st := e.emit, e.st
	e.mu.Unlock()
	emit(api.EventStatus, st)
	e.Log("info", "simulation", "Trajet mis en pause")
	return nil
}

// ResumeRoute un-freezes a simulation paused by PauseRoute.
func (e *Engine) ResumeRoute(ctx context.Context) error {
	e.simMu.Lock()
	hasSim := e.cancelSim != nil
	if hasSim {
		e.simPaused = false
	}
	e.simMu.Unlock()
	if !hasSim {
		return nil
	}

	e.mu.Lock()
	e.st.State = "moving"
	if e.st.Navigation.Status != nil {
		e.st.Navigation.Status.State = "running"
	}
	emit, st := e.emit, e.st
	e.mu.Unlock()
	emit(api.EventStatus, st)
	e.Log("info", "simulation", "Trajet repris")
	return nil
}

// isPaused reports whether the active simulation should skip this tick.
func (e *Engine) isPaused() bool {
	e.simMu.Lock()
	defer e.simMu.Unlock()
	return e.simPaused
}

// PlayRoute fetches a route from OSRM and runs the movement simulation
func (e *Engine) PlayRoute(ctx context.Context, endLat, lon float64, speed float64, profile string) error {
	e.stopActiveSimulation()

	e.mu.RLock()
	var start domain.LatLon
	if e.st.LastInjectedLocation != nil {
		start = domain.LatLon{Lat: e.st.LastInjectedLocation.Lat, Lon: e.st.LastInjectedLocation.Lon}
	} else {
		start = domain.LatLon{Lat: 48.8566, Lon: 2.3522} // Paris default
	}
	e.mu.RUnlock()

	end := domain.LatLon{Lat: endLat, Lon: lon}
	rawPoints, err := fetchOSRMRoute(start, end, profile)
	if err != nil {
		rawPoints = []domain.LatLon{start, end}
	}

	points := interpolatePoints(rawPoints, speed)

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, points, false)
	return nil
}

// PlaySequence plays a multimodal journey of legs
func (e *Engine) PlaySequence(ctx context.Context, legs []domain.RouteLeg, looping bool) error {
	e.stopActiveSimulation()

	var allPoints []domain.LatLon
	for _, leg := range legs {
		if leg.Type == domain.LegDrive || leg.Type == domain.LegWalk {
			profile := "driving"
			if leg.Type == domain.LegWalk {
				profile = "foot"
			}
			rawPoints, err := fetchOSRMRoute(leg.Start, leg.End, profile)
			if err != nil {
				rawPoints = []domain.LatLon{leg.Start, leg.End}
			}
			points := interpolatePoints(rawPoints, leg.Speed)
			allPoints = append(allPoints, points...)
		} else if leg.Type == domain.LegFlight {
			rawPoints := []domain.LatLon{leg.Start, leg.End}
			points := interpolatePoints(rawPoints, leg.Speed)
			allPoints = append(allPoints, points...)
		}
	}

	if len(allPoints) == 0 {
		return fmt.Errorf("no points to play")
	}

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, allPoints, looping)
	return nil
}

// PlayCustomGpx parses the GPX content and plays the route
func (e *Engine) PlayCustomGpx(ctx context.Context, gpxContent string, speedKmh float64) error {
	e.stopActiveSimulation()

	points := parseGPXCoordinates(gpxContent)
	if len(points) == 0 {
		return fmt.Errorf("no GPX points parsed")
	}

	interpolated := interpolatePoints(points, speedKmh)

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, interpolated, false)
	return nil
}

// PatrolUpdate sets/toggles the patrol zone and starts/stops simulated wandering
func (e *Engine) PatrolUpdate(ctx context.Context, zone domain.PatrolZone) error {
	e.stopActiveSimulation()

	e.mu.Lock()
	e.st.PatrolZone = &zone
	e.emit(api.EventStatus, e.st)
	e.mu.Unlock()

	if zone.Active {
		simCtx, cancel := context.WithCancel(context.Background())
		e.simMu.Lock()
		e.cancelSim = cancel
		e.simMu.Unlock()

		go e.startPatrolSimulation(simCtx, zone)
	}

	return nil
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

// AddFavorite adds a new favorite location
func (e *Engine) AddFavorite(ctx context.Context, lat, lon float64, name string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, f := range e.st.Favorites {
		if f.Lat == lat && f.Lon == lon {
			return nil
		}
	}
	e.st.Favorites = append(e.st.Favorites, domain.Favorite{
		Lat:       lat,
		Lon:       lon,
		Name:      name,
		Timestamp: time.Now().UnixMilli(),
	})
	e.emit(api.EventStatus, e.st)
	return nil
}

// RemoveFavorite deletes a favorite location
func (e *Engine) RemoveFavorite(ctx context.Context, lat, lon float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	var updated []domain.Favorite
	for _, f := range e.st.Favorites {
		if f.Lat == lat && f.Lon == lon {
			continue
		}
		updated = append(updated, f)
	}
	e.st.Favorites = updated
	e.emit(api.EventStatus, e.st)
	return nil
}

// RenameFavorite renames a favorite location
func (e *Engine) RenameFavorite(ctx context.Context, lat, lon float64, newName string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, f := range e.st.Favorites {
		if f.Lat == lat && f.Lon == lon {
			e.st.Favorites[i].Name = newName
			break
		}
	}
	e.emit(api.EventStatus, e.st)
	return nil
}

// ClearHistory wipes the recent-history list — an admin/housekeeping action,
// distinct from favorites (which the user curates deliberately).
func (e *Engine) ClearHistory(ctx context.Context) error {
	e.mu.Lock()
	e.st.RecentHistory = nil
	emit, st := e.emit, e.st
	e.mu.Unlock()
	emit(api.EventStatus, st)
	e.Log("info", "admin", "Historique vidé")
	return nil
}

// SaveSettings saves and applies configuration settings
func (e *Engine) SaveSettings(ctx context.Context, payload api.SaveSettingsPayload) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if val, ok := payload["companionPort"]; ok {
		if port, ok := val.(float64); ok {
			e.st.RSDPort = int(port)
		}
	}
	if val, ok := payload["usbDriver"]; ok {
		if drv, ok := val.(string); ok {
			e.st.UsbDriver = domain.DriverID(drv)
		}
	}
	if val, ok := payload["wifiDriver"]; ok {
		if drv, ok := val.(string); ok {
			e.st.WifiDriver = domain.DriverID(drv)
		}
	}
	if val, ok := payload["fallbackEnabled"]; ok {
		if fallback, ok := val.(bool); ok {
			e.st.FallbackEnabled = fallback
		}
	}
	if val, ok := payload["notificationsEnabled"]; ok {
		if notif, ok := val.(bool); ok {
			e.st.NotificationsEnabled = notif
		}
	}
	if val, ok := payload["dynamicIslandEnabled"]; ok {
		if island, ok := val.(bool); ok {
			e.st.DynamicIslandEnabled = island
		}
	}

	mgr := e.clusterMgr
	clusterMode, hasMode := payload["clusterMode"].(string)
	rawNodes, hasNodes := payload["clusterNodes"].([]any)
	syncCerts, hasSyncCerts := payload["clusterSyncCerts"].(bool)
	if mgr != nil && (hasMode || hasNodes || hasSyncCerts) {
		var nodeAddrs []string
		if hasNodes {
			for _, n := range rawNodes {
				if s, ok := n.(string); ok {
					nodeAddrs = append(nodeAddrs, s)
				}
			}
		} else {
			for _, p := range mgr.Status().Peers {
				if !p.Discovered {
					nodeAddrs = append(nodeAddrs, fmt.Sprintf("%s:%d", p.Address, p.Port))
				}
			}
		}
		mode := mgr.Status().Mode
		if hasMode {
			mode = clusterMode
		}
		if !hasSyncCerts {
			syncCerts = mgr.SyncCertsEnabled()
		}
		go mgr.UpdateConfig(ctx, mode, nodeAddrs, syncCerts)
	}

	e.emit(api.EventStatus, e.st)
	return nil
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
