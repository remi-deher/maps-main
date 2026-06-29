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
	"github.com/remi-deher/maps-main/engine/internal/logging"
	"github.com/remi-deher/maps-main/engine/internal/routing"
	"github.com/remi-deher/maps-main/engine/internal/settings"
	sim "github.com/remi-deher/maps-main/engine/internal/simulation"
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
	logService *logging.Service

	// driverCfgBase holds the resolved binary paths/manual address from
	// startup (cmd/headless), so SwitchDriver can rebuild a driver.Config at
	// runtime without re-resolving python/go-ios from PATH every time.
	driverCfgBase driver.Config

	// clusterMgr is optional: set via SetClusterManager when cluster mode is
	// enabled, nil otherwise (Status() then omits the Cluster field).
	clusterMgr *cluster.Manager

	// routingRegistry owns route-provider config, availability, priority and
	// fallback selection. Engine only asks it for normalized route geometry.
	routingRegistry *routing.Registry

	// store persists settings to disk (SQLite) so they survive a restart
	// instead of resetting to settings.Default() every time. Nil disables
	// persistence (e.g. in tests).
	store       settings.Store
	secretStore settings.SecretStore
}

// SetClusterManager attaches the HA cluster manager so Status() reports its
// state and SaveSettings can push live config changes to it.
func New(drv driver.Driver, cfg settings.Settings) *Engine {
	return NewWithSecrets(drv, cfg, settings.Secrets{})
}

// NewWithSecrets builds an Engine seeded from settings plus server-only
// secrets loaded from a SecretStore.
func NewWithSecrets(drv driver.Driver, cfg settings.Settings, secrets settings.Secrets) *Engine {
	runtimeCfg := cfg.RuntimeConfig()
	// Seed cluster tuning from persisted settings (falling back to the env/
	// built-in defaults the cluster package already holds) so the live values
	// and the broadcast status agree from the first STATUS.
	if runtimeCfg.ClusterHeartbeatSeconds > 0 || runtimeCfg.ClusterMasterDeadSeconds > 0 || runtimeCfg.ClusterPeerTimeoutSeconds > 0 {
		cluster.SetTuning(
			time.Duration(runtimeCfg.ClusterHeartbeatSeconds)*time.Second,
			time.Duration(runtimeCfg.ClusterMasterDeadSeconds)*time.Second,
			time.Duration(runtimeCfg.ClusterPeerTimeoutSeconds)*time.Second,
		)
	}
	hb, dead, peer := cluster.GetTuning()

	osrm := runtimeCfg.OsrmBaseURL
	if osrm == "" {
		osrm = defaultOsrmBaseURL()
	}
	routingRegistry := routing.NewRegistry(routing.Config{
		OSRMBaseURL:        osrm,
		Mode:               runtimeCfg.RoutingMode,
		Provider:           runtimeCfg.RoutingProvider,
		ProviderPriority:   runtimeCfg.RoutingProviderPriority,
		GoogleRoutesAPIKey: firstNonEmpty(secrets.GoogleRoutesAPIKey, os.Getenv("GOOGLE_MAPS_API_KEY"), os.Getenv("GOOGLE_ROUTES_API_KEY")),
		MapboxAccessToken:  firstNonEmpty(secrets.MapboxAccessToken, os.Getenv("MAPBOX_ACCESS_TOKEN")),
	})
	routingInfo := apiRoutingInfo(routingRegistry.Info())

	return &Engine{
		drv:             drv,
		emit:            func(string, any) {}, // no-op until the server wires OnEvent
		routingRegistry: routingRegistry,
		logService:      logging.NewService(maxLogEntries),
		st: api.Status{
			State:                     "idle",
			ConnectionType:            domain.ConnUnknown,
			UsbDriver:                 runtimeCfg.UsbDriver,
			WifiDriver:                runtimeCfg.WifiDriver,
			FallbackEnabled:           runtimeCfg.FallbackEnabled,
			NotificationsEnabled:      runtimeCfg.NotificationsEnabled,
			DynamicIslandEnabled:      runtimeCfg.DynamicIslandEnabled,
			JitterEnabled:             runtimeCfg.JitterEnabled,
			Favorites:                 runtimeCfg.Favorites,
			RecentHistory:             runtimeCfg.RecentHistory,
			Navigation:                domain.Navigation{},
			OsrmBaseURL:               osrm,
			Routing:                   routingInfo,
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

	dist := sim.Distance(domain.LatLon{Lat: lat, Lon: lon}, domain.LatLon{Lat: target.Lat, Lon: target.Lon})
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
	// Log each successful keep-alive re-injection so the periodic relances stay
	// visible in the logs (as they were before the jitter change). Show the
	// actually-injected jittered point at 7 decimals — the ~±0.000001° micro
	// movement is invisible at the 6-decimal precision used elsewhere — so the
	// keep-alive drift is verifiable. The stable anchor goes in the fields.
	e.LogEvent("info", "engine", "location", "relance", fmt.Sprintf("Position maintenue (dérive) : %.7f, %.7f", injLat, injLon), map[string]string{
		"injLat":    fmt.Sprintf("%.7f", injLat),
		"injLon":    fmt.Sprintf("%.7f", injLon),
		"anchorLat": fmt.Sprintf("%.6f", anchor.Lat),
		"anchorLon": fmt.Sprintf("%.6f", anchor.Lon),
		"name":      anchor.Name,
	})
	return nil
}

func nowMs() int64 { return time.Now().UnixMilli() }

func isDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
