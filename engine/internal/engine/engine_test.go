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

// TestEmitNeverHoldsTheLock is a regression test: AddFavorite, RemoveFavorite,
// RenameFavorite and PatrolUpdate used to call e.emit(...) while still
// holding e.mu (via `defer e.mu.Unlock()` or a bare e.mu.Lock()/emit/Unlock).
// Since emit is a callback into client code (the server's hub broadcast),
// anything that re-enters the engine from within it — like calling
// Status(), which takes e.mu.RLock() — would deadlock. Each call below
// re-enters via Status() from inside emit and must return promptly.
func TestEmitNeverHoldsTheLock(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	eng.OnEvent(func(string, any) {
		_ = eng.Status() // would deadlock if emit is called while e.mu is held
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		ctx := context.Background()
		_ = eng.AddFavorite(ctx, 1, 1, "A")
		_ = eng.RenameFavorite(ctx, 1, 1, "B")
		_ = eng.RemoveFavorite(ctx, 1, 1)
		_ = eng.PatrolUpdate(ctx, domain.PatrolZone{Active: false})
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("deadlock: emit appears to be called while e.mu is still held")
	}
}

func TestAddFavoriteDeduplicatesByCoordinate(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	ctx := context.Background()

	if err := eng.AddFavorite(ctx, 48.8566, 2.3522, "Paris"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}
	if err := eng.AddFavorite(ctx, 48.8566, 2.3522, "Paris (dup)"); err != nil {
		t.Fatalf("AddFavorite (dup): %v", err)
	}

	favs := eng.Status().Favorites
	if len(favs) != 1 {
		t.Fatalf("expected duplicate coordinate to be a no-op, got %d favorites", len(favs))
	}
	if favs[0].Name != "Paris" {
		t.Errorf("expected the original name to be kept, got %q", favs[0].Name)
	}
}

func TestRemoveFavorite(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	ctx := context.Background()
	_ = eng.AddFavorite(ctx, 1, 1, "A")
	_ = eng.AddFavorite(ctx, 2, 2, "B")

	if err := eng.RemoveFavorite(ctx, 1, 1); err != nil {
		t.Fatalf("RemoveFavorite: %v", err)
	}
	favs := eng.Status().Favorites
	if len(favs) != 1 || favs[0].Name != "B" {
		t.Fatalf("expected only B to remain, got %+v", favs)
	}
}

func TestRenameFavorite(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	ctx := context.Background()
	_ = eng.AddFavorite(ctx, 1, 1, "Old Name")

	if err := eng.RenameFavorite(ctx, 1, 1, "New Name"); err != nil {
		t.Fatalf("RenameFavorite: %v", err)
	}
	favs := eng.Status().Favorites
	if len(favs) != 1 || favs[0].Name != "New Name" {
		t.Fatalf("expected renamed favorite, got %+v", favs)
	}
}

func TestClearHistory(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 1, Type: domain.ConnUSB}
	eng := New(&mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}, settings.Default())
	ctx := context.Background()
	_ = eng.StartTunnel(ctx)
	_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris")

	if got := eng.Status().RecentHistory; len(got) == 0 {
		t.Fatal("expected SetLocation to record history before clearing")
	}
	if err := eng.ClearHistory(ctx); err != nil {
		t.Fatalf("ClearHistory: %v", err)
	}
	if got := eng.Status().RecentHistory; len(got) != 0 {
		t.Errorf("expected empty history after ClearHistory, got %d entries", len(got))
	}
}

func TestPushHistoryDeduplicatesConsecutiveSamePosition(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 1, Type: domain.ConnUSB}
	eng := New(&mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}, settings.Default())
	ctx := context.Background()
	_ = eng.StartTunnel(ctx)

	_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris")
	_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris again") // same coords, consecutive

	if got := len(eng.Status().RecentHistory); got != 1 {
		t.Errorf("expected consecutive duplicate position to be deduplicated, got %d entries", got)
	}

	_ = eng.SetLocation(ctx, 45.7640, 4.8357, "Lyon") // different coords
	if got := len(eng.Status().RecentHistory); got != 2 {
		t.Errorf("expected a genuinely new position to be recorded, got %d entries", got)
	}
}

func TestSaveSettingsAppliesKnownFields(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	payload := api.SaveSettingsPayload{
		"companionPort":        float64(9999),
		"usbDriver":            "go-ios",
		"fallbackEnabled":      true,
		"notificationsEnabled": true,
	}
	if err := eng.SaveSettings(context.Background(), payload); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	st := eng.Status()
	if st.RSDPort != 9999 {
		t.Errorf("RSDPort = %d, want 9999", st.RSDPort)
	}
	if st.UsbDriver != domain.DriverID("go-ios") {
		t.Errorf("UsbDriver = %q, want go-ios", st.UsbDriver)
	}
	if !st.FallbackEnabled || !st.NotificationsEnabled {
		t.Errorf("expected fallbackEnabled and notificationsEnabled to be true, got %+v", st)
	}
}

func TestSaveSettingsAppliesJitterEnabled(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	if !eng.Status().JitterEnabled {
		t.Fatalf("expected JitterEnabled to default to true")
	}

	if err := eng.SaveSettings(context.Background(), api.SaveSettingsPayload{"jitterEnabled": false}); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if eng.Status().JitterEnabled {
		t.Errorf("expected JitterEnabled to be false after SaveSettings, got true")
	}

	if err := eng.SaveSettings(context.Background(), api.SaveSettingsPayload{"jitterEnabled": true}); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if !eng.Status().JitterEnabled {
		t.Errorf("expected JitterEnabled to be true again after re-enabling, got false")
	}
}

func TestSaveSettingsIgnoresWrongTypedValues(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	before := eng.Status()

	// Wrong Go type for each key (string where bool/float expected, etc.) —
	// every field must be left untouched rather than panicking or zeroing out.
	payload := api.SaveSettingsPayload{
		"companionPort":   "not-a-number",
		"fallbackEnabled": "not-a-bool",
		"jitterEnabled":   "not-a-bool",
	}
	if err := eng.SaveSettings(context.Background(), payload); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	after := eng.Status()
	if after.RSDPort != before.RSDPort || after.FallbackEnabled != before.FallbackEnabled || after.JitterEnabled != before.JitterEnabled {
		t.Errorf("expected mistyped settings values to be ignored, before=%+v after=%+v", before, after)
	}
}

func TestRelanceReplaysLastInjectedLocation(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 1, Type: domain.ConnUSB}
	drv := &mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}
	eng := New(drv, settings.Default())
	ctx := context.Background()
	_ = eng.StartTunnel(ctx)
	_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris")

	drv.setLocationCalled = false // reset so we can tell Relance actually re-injected
	if err := eng.Relance(ctx); err != nil {
		t.Fatalf("Relance: %v", err)
	}
	if !drv.setLocationCalled || drv.setLat != 48.8566 || drv.setLon != 2.3522 {
		t.Errorf("expected Relance to re-inject the last location, driver state: %+v", drv)
	}
}

func TestRelanceNoopWithoutPriorLocation(t *testing.T) {
	drv := &mockDriver{id: domain.DriverPmd3}
	eng := New(drv, settings.Default())
	if err := eng.Relance(context.Background()); err != nil {
		t.Fatalf("Relance: %v", err)
	}
	if drv.setLocationCalled {
		t.Error("expected Relance to be a no-op without a prior injected location")
	}
}

func TestGetDeviceInfoUnsupportedByDriver(t *testing.T) {
	// mockDriver doesn't implement driver.DeviceInfoProvider.
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	if _, err := eng.GetDeviceInfo(context.Background()); err == nil {
		t.Error("expected an error when the active driver doesn't support device info")
	}
}

func TestLogAndGetLogs(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	eng.Log("info", "test", "hello")
	eng.Log("error", "test", "world")

	logs := eng.GetLogs()
	if len(logs) != 2 {
		t.Fatalf("expected 2 log entries, got %d", len(logs))
	}
	if logs[0].Message != "hello" || logs[1].Message != "world" {
		t.Errorf("unexpected log order/content: %+v", logs)
	}
}

func TestLogCapsBufferAtMaxEntries(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	for i := 0; i < maxLogEntries+10; i++ {
		eng.Log("info", "test", "entry")
	}
	logs := eng.GetLogs()
	if len(logs) != maxLogEntries {
		t.Errorf("expected log buffer capped at %d, got %d", maxLogEntries, len(logs))
	}
}

func TestReportRealLocationUpdatesVerifiedWithinTolerance(t *testing.T) {
	ti := driver.TunnelInfo{Address: "127.0.0.1", Port: 1, Type: domain.ConnUSB}
	drv := &mockDriver{id: domain.DriverPmd3, tunnelInfo: ti}
	eng := New(drv, settings.Default())
	ctx := context.Background()
	_ = eng.StartTunnel(ctx)
	_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris")

	// A few meters off (well under the 100m drift threshold).
	eng.ReportRealLocation(ctx, 48.85661, 2.35221)

	st := eng.Status()
	if st.LastRealLocation == nil {
		t.Fatal("expected LastRealLocation to be set")
	}
	if st.LastVerifiedLocation == nil {
		t.Error("expected LastVerifiedLocation to be set when drift is within tolerance")
	}
}

func TestReportRealLocationNoopWithoutInjectedLocation(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	eng.ReportRealLocation(context.Background(), 48.8566, 2.3522)
	if got := eng.Status().LastRealLocation; got != nil {
		t.Errorf("expected no-op without a prior injected/verified location, got %+v", got)
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
