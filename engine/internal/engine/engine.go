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
	simMu     sync.Mutex
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
	ti, err := e.drv.StartTunnel(ctx)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.st.TunnelActive = true
	e.st.RSDAddress = ti.Address
	e.st.RSDPort = ti.Port
	e.st.ConnectionType = ti.Type
	e.st.DeviceInfo = &domain.DeviceInfo{Name: "iPhone", Driver: e.drv.ID()}
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
	if err := e.drv.SetLocation(ctx, lat, lon); err != nil {
		return err
	}
	now := nowMs()
	e.mu.Lock()
	e.st.LastInjectedLocation = &api.LocationStamp{Lat: lat, Lon: lon, Name: name, Timestamp: now}
	e.st.State = "running"
	emit, st := e.emit, e.st
	e.mu.Unlock()

	emit(api.EventAck, api.AckPayload{Lat: lat, Lon: lon, Timestamp: now})
	emit(api.EventLocation, api.LocationPayload{Lat: lat, Lon: lon, Name: name})
	emit(api.EventStatus, st)
	return nil
}

// ClearLocation removes any spoofed position and broadcasts ACK/STATUS.
func (e *Engine) ClearLocation(ctx context.Context) error {
	if err := e.drv.ClearLocation(ctx); err != nil {
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

// Status returns a snapshot of the current state.
func (e *Engine) Status() api.Status {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.st
}

// stopActiveSimulation terminates any running routing/navigation or patrol goroutines
func (e *Engine) stopActiveSimulation() {
	e.simMu.Lock()
	defer e.simMu.Unlock()
	if e.cancelSim != nil {
		e.cancelSim()
		e.cancelSim = nil
	}
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

