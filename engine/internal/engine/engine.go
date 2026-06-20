// Package engine is the orchestrator: it holds the live Status, applies inbound
// actions through the selected Driver, and emits outbound events. It is
// transport-agnostic — the server package wires it to HTTP/WebSocket.
package engine

import (
	"context"
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
	drv  driver.Driver
	mu   sync.RWMutex
	st   api.Status
	emit EmitFunc
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

func nowMs() int64 { return time.Now().UnixMilli() }

func isDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
