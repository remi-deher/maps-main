package engine

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// failingStartDriver comes up once, then refuses to start again — the shape of
// a device that was unplugged between two restart attempts.
type failingStartDriver struct {
	mockDriver
	failStart bool
}

func (d *failingStartDriver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.failStart {
		return driver.TunnelInfo{}, errors.New("device not found")
	}
	return d.mockDriver.StartTunnel(ctx)
}

// RestartTunnel is the user-facing "reconnect" button. It must tear the tunnel
// down and bring it back, and — crucially — stop whatever simulation was
// running against the old tunnel rather than let it keep injecting into a
// connection that no longer exists.
func TestRestartTunnelStopsTheSimulationAndReconnects(t *testing.T) {
	drv := &failingStartDriver{mockDriver: mockDriver{
		id:         domain.DriverPmd3,
		tunnelInfo: driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB},
	}}
	eng := New(drv, settings.Default())
	if err := eng.StartTunnel(context.Background()); err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if err := eng.PlayCustomGpx(context.Background(), testGPX, 50); err != nil {
		t.Fatalf("PlayCustomGpx: %v", err)
	}

	if err := eng.RestartTunnel(context.Background()); err != nil {
		t.Fatalf("RestartTunnel: %v", err)
	}

	eng.simMu.Lock()
	stillRunning := eng.cancelSim != nil
	eng.simMu.Unlock()
	if stillRunning {
		t.Error("RestartTunnel left the previous simulation running")
	}
	if !eng.TunnelActive() {
		t.Error("TunnelActive() = false after a successful restart")
	}
}

// A failed restart must surface the error to the caller and log it, not report
// a tunnel that isn't there.
func TestRestartTunnelReportsAFailedRestart(t *testing.T) {
	drv := &failingStartDriver{mockDriver: mockDriver{
		id:         domain.DriverPmd3,
		tunnelInfo: driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB},
	}}
	eng := New(drv, settings.Default())
	if err := eng.StartTunnel(context.Background()); err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}

	drv.failStart = true
	if err := eng.RestartTunnel(context.Background()); err == nil {
		t.Fatal("RestartTunnel returned nil for a driver that could not start")
	}
	if eng.TunnelActive() {
		t.Error("TunnelActive() = true after a failed restart")
	}

	var logged bool
	for _, entry := range eng.GetLogs() {
		if entry.Level == "error" && entry.Action == "restart-tunnel" {
			logged = true
			break
		}
	}
	if !logged {
		t.Error("a failed tunnel restart produced no error log entry")
	}
}

// ResetHealthBackoff is signalled from several places (the maintenance actions,
// a driver switch) while the health loop may not be running at all. It has to
// stay non-blocking in every case.
func TestResetHealthBackoffNeverBlocks(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())

	done := make(chan struct{})
	go func() {
		defer close(done)
		// More signals than the channel can hold, with nothing draining it.
		for range 10 {
			eng.ResetHealthBackoff()
		}
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("ResetHealthBackoff blocked with nothing draining the channel")
	}
}

func TestLogHelpersRecordTheirLevel(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())

	eng.Log("info", "test", "message info")
	eng.LogDebug("test", "message debug")
	eng.LogConsole("test", "message console")

	levels := map[string]bool{}
	for _, entry := range eng.GetLogs() {
		if entry.Source == "test" {
			levels[entry.Level] = true
		}
	}
	for _, want := range []string{"info", "debug", "console"} {
		if !levels[want] {
			t.Errorf("no log entry at level %q", want)
		}
	}
}

// Cluster mode is off by default, and Status() must simply omit the block
// rather than dereference a nil manager.
func TestClusterManagerIsOptional(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())

	if eng.ClusterManager() != nil {
		t.Error("ClusterManager() is non-nil before one is attached")
	}
	if eng.Status().Cluster != nil {
		t.Error("Status().Cluster is populated with no cluster manager attached")
	}
}
