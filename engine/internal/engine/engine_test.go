package engine

import (
	"context"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

type mockDriver struct {
	id                  domain.DriverID
	tunnelInfo          driver.TunnelInfo
	tunnelOn            bool
	setLat              float64
	setLon              float64
	setLocationCalled   bool
	clearLocationCalled bool
}

func (m *mockDriver) ID() domain.DriverID { return m.id }

func (m *mockDriver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	m.tunnelOn = true
	return m.tunnelInfo, nil
}

func (m *mockDriver) StopTunnel(ctx context.Context) error {
	m.tunnelOn = false
	return nil
}

func (m *mockDriver) SetLocation(ctx context.Context, lat, lon float64) error {
	m.setLat = lat
	m.setLon = lon
	m.setLocationCalled = true
	return nil
}

func (m *mockDriver) ClearLocation(ctx context.Context) error {
	m.clearLocationCalled = true
	m.setLat = 0
	m.setLon = 0
	return nil
}

func (m *mockDriver) CheckHealth(ctx context.Context) bool {
	return m.tunnelOn
}

func (m *mockDriver) ListDevices(ctx context.Context) ([]driver.Device, error) {
	return []driver.Device{{UDID: "test-udid", Name: "Test iPhone", Source: "usb"}}, nil
}

func (m *mockDriver) Tunnel() (driver.TunnelInfo, bool) {
	return m.tunnelInfo, m.tunnelOn
}

func TestEngineInit(t *testing.T) {
	drv := &mockDriver{id: domain.DriverPmd3}
	cfg := settings.Default()
	eng := New(drv, cfg)

	st := eng.Status()
	if st.State != "idle" {
		t.Errorf("expected initial state 'idle', got %q", st.State)
	}
	if st.TunnelActive {
		t.Errorf("expected tunnel not to be active initially")
	}
	if st.UsbDriver != domain.DriverPmd3 {
		t.Errorf("expected usb driver %s, got %s", domain.DriverPmd3, st.UsbDriver)
	}
}

func TestEngineStartTunnel(t *testing.T) {
	ti := driver.TunnelInfo{
		Address: "127.0.0.1",
		Port:    54321,
		Type:    domain.ConnUSB,
		Since:   time.Now(),
	}
	drv := &mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}
	cfg := settings.Default()
	eng := New(drv, cfg)

	eventEmitted := false
	eng.OnEvent(func(eventType string, data any) {
		if eventType == api.EventStatus {
			st, ok := data.(api.Status)
			if !ok {
				t.Errorf("expected status event payload, got %T", data)
			}
			if !st.TunnelActive || st.RSDAddress != "127.0.0.1" || st.RSDPort != 54321 {
				t.Errorf("incorrect status payload: %+v", st)
			}
			eventEmitted = true
		}
	})

	err := eng.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("unexpected StartTunnel error: %v", err)
	}

	st := eng.Status()
	if st.State != "ready" {
		t.Errorf("expected state 'ready' after StartTunnel, got %q", st.State)
	}
	if !st.TunnelActive {
		t.Errorf("expected TunnelActive to be true")
	}
	if !eventEmitted {
		t.Errorf("expected status event to be emitted")
	}
}

func TestEngineSetLocation(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB}
	drv := &mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}
	cfg := settings.Default()
	eng := New(drv, cfg)

	// Pre-start tunnel to transition state
	_ = eng.StartTunnel(context.Background())

	events := make(map[string]bool)
	eng.OnEvent(func(eventType string, data any) {
		events[eventType] = true
	})

	err := eng.SetLocation(context.Background(), 48.8566, 2.3522, "Paris")
	if err != nil {
		t.Fatalf("unexpected SetLocation error: %v", err)
	}

	if !drv.setLocationCalled {
		t.Errorf("expected driver SetLocation to be called")
	}
	if drv.setLat != 48.8566 || drv.setLon != 2.3522 {
		t.Errorf("incorrect coordinates set on driver: %f, %f", drv.setLat, drv.setLon)
	}

	st := eng.Status()
	if st.State != "running" {
		t.Errorf("expected state 'running' after SetLocation, got %q", st.State)
	}
	if st.LastInjectedLocation == nil || st.LastInjectedLocation.Name != "Paris" {
		t.Errorf("expected LastInjectedLocation to be Paris")
	}

	for _, ev := range []string{api.EventAck, api.EventLocation, api.EventStatus} {
		if !events[ev] {
			t.Errorf("expected event %q to be emitted", ev)
		}
	}
}

func TestEngineClearLocation(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB}
	drv := &mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}
	cfg := settings.Default()
	eng := New(drv, cfg)

	_ = eng.StartTunnel(context.Background())
	_ = eng.SetLocation(context.Background(), 48.8566, 2.3522, "Paris")

	events := make(map[string]bool)
	eng.OnEvent(func(eventType string, data any) {
		events[eventType] = true
	})

	err := eng.ClearLocation(context.Background())
	if err != nil {
		t.Fatalf("unexpected ClearLocation error: %v", err)
	}

	if !drv.clearLocationCalled {
		t.Errorf("expected driver ClearLocation to be called")
	}

	st := eng.Status()
	if st.State != "ready" {
		t.Errorf("expected state to return to 'ready' after ClearLocation, got %q", st.State)
	}
	if st.LastInjectedLocation != nil {
		t.Errorf("expected LastInjectedLocation to be nil")
	}

	for _, ev := range []string{api.EventAck, api.EventStatus} {
		if !events[ev] {
			t.Errorf("expected event %q to be emitted", ev)
		}
	}
}

func TestEngineHeartbeat(t *testing.T) {
	drv := &mockDriver{id: domain.DriverPmd3}
	cfg := settings.Default()
	eng := New(drv, cfg)

	payload := api.HeartbeatPayload{IsMaintaining: true}
	pong := eng.Heartbeat(payload)

	if pong.Timestamp <= 0 {
		t.Errorf("expected positive pong timestamp, got %d", pong.Timestamp)
	}

	st := eng.Status()
	if !st.MaintainActive {
		t.Errorf("expected MaintainActive to be true")
	}
	if st.LastHeartbeat <= 0 {
		t.Errorf("expected positive LastHeartbeat timestamp")
	}
}
