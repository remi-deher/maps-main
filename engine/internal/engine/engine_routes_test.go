package engine

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// A minimal but valid GPX track, used to start a real simulation without
// touching a routing provider (and therefore without a network call).
const testGPX = `<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg>
<trkpt lat="48.8566" lon="2.3522"></trkpt>
<trkpt lat="48.8600" lon="2.3600"></trkpt>
<trkpt lat="48.8650" lon="2.3700"></trkpt>
</trkseg></trk></gpx>`

func newRunningEngine(t *testing.T) *Engine {
	t.Helper()
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	if err := eng.PlayCustomGpx(context.Background(), testGPX, 50); err != nil {
		t.Fatalf("PlayCustomGpx: %v", err)
	}
	return eng
}

// The pause/resume contract is the one users notice: pausing must preserve the
// simulation (so resuming continues rather than restarting), and both must be
// reflected in the broadcast status.
func TestPauseAndResumePreserveTheSimulation(t *testing.T) {
	eng := newRunningEngine(t)
	t.Cleanup(func() { _ = eng.StopRoute(context.Background()) })

	if err := eng.PauseRoute(context.Background()); err != nil {
		t.Fatalf("PauseRoute: %v", err)
	}
	if !eng.isPaused() {
		t.Error("isPaused() = false after PauseRoute")
	}
	if got := eng.Status().State; got != "paused" {
		t.Errorf("state = %q, want paused", got)
	}
	// The simulation itself must still be there — that's what separates pause
	// from stop.
	eng.simMu.Lock()
	stillRunning := eng.cancelSim != nil
	eng.simMu.Unlock()
	if !stillRunning {
		t.Error("PauseRoute cancelled the simulation; it should only freeze it")
	}

	if err := eng.ResumeRoute(context.Background()); err != nil {
		t.Fatalf("ResumeRoute: %v", err)
	}
	if eng.isPaused() {
		t.Error("isPaused() = true after ResumeRoute")
	}
	if got := eng.Status().State; got != "moving" {
		t.Errorf("state = %q, want moving", got)
	}
}

// Pausing or resuming with nothing running must be a no-op rather than moving
// the engine into a state that doesn't match reality — a client is free to send
// PAUSE_ROUTE at any time.
func TestPauseAndResumeAreNoopsWithoutASimulation(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	before := eng.Status().State

	if err := eng.PauseRoute(context.Background()); err != nil {
		t.Fatalf("PauseRoute: %v", err)
	}
	if got := eng.Status().State; got != before {
		t.Errorf("state = %q after a no-op pause, want it unchanged (%q)", got, before)
	}
	if err := eng.ResumeRoute(context.Background()); err != nil {
		t.Fatalf("ResumeRoute: %v", err)
	}
	if got := eng.Status().State; got != before {
		t.Errorf("state = %q after a no-op resume, want it unchanged (%q)", got, before)
	}
}

func TestStopRouteClearsNavigationAndResetsPause(t *testing.T) {
	eng := newRunningEngine(t)
	if err := eng.PauseRoute(context.Background()); err != nil {
		t.Fatalf("PauseRoute: %v", err)
	}

	if err := eng.StopRoute(context.Background()); err != nil {
		t.Fatalf("StopRoute: %v", err)
	}

	st := eng.Status()
	if st.State != "ready" {
		t.Errorf("state = %q, want ready", st.State)
	}
	if st.Navigation.Status != nil || st.Navigation.Progress != nil {
		t.Errorf("navigation not cleared: %+v", st.Navigation)
	}
	if st.CurrentSequencePreview != nil {
		t.Error("CurrentSequencePreview not cleared")
	}
	// A stop must clear the paused flag too, otherwise the next simulation
	// would start frozen.
	if eng.isPaused() {
		t.Error("isPaused() = true after StopRoute")
	}
	eng.simMu.Lock()
	cancelled := eng.cancelSim == nil
	eng.simMu.Unlock()
	if !cancelled {
		t.Error("StopRoute left the simulation running")
	}
}

// Starting a second simulation must cancel the first, not run both against the
// same device.
func TestStartingASimulationCancelsThePreviousOne(t *testing.T) {
	eng := newRunningEngine(t)
	t.Cleanup(func() { _ = eng.StopRoute(context.Background()) })

	// Pause the first simulation, then start a second one: if the second start
	// didn't go through stopActiveSimulation, the paused flag would survive and
	// the fresh simulation would be frozen from the outset.
	if err := eng.PauseRoute(context.Background()); err != nil {
		t.Fatalf("PauseRoute: %v", err)
	}

	if err := eng.PlayCustomGpx(context.Background(), testGPX, 30); err != nil {
		t.Fatalf("second PlayCustomGpx: %v", err)
	}

	if eng.isPaused() {
		t.Error("the new simulation inherited the previous one's paused state")
	}
	eng.simMu.Lock()
	running := eng.cancelSim != nil
	eng.simMu.Unlock()
	if !running {
		t.Fatal("no simulation running after the second play")
	}
}

func TestPlayCustomGpxRejectsUnparseableContent(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())

	for _, tc := range []struct{ name, content string }{
		{"empty", ""},
		{"no track points", `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := eng.PlayCustomGpx(context.Background(), tc.content, 50); err == nil {
				t.Error("PlayCustomGpx accepted content with no usable points")
			}
			eng.simMu.Lock()
			running := eng.cancelSim != nil
			eng.simMu.Unlock()
			if running {
				t.Error("a rejected GPX still started a simulation")
			}
		})
	}
}

// A flight leg is interpolated directly between its endpoints, so this path
// exercises PlaySequence without reaching a routing provider.
func TestPlaySequenceWithFlightLegs(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	t.Cleanup(func() { _ = eng.StopRoute(context.Background()) })

	legs := []domain.RouteLeg{{
		Type:  domain.LegFlight,
		Start: domain.LatLon{Lat: 48.8566, Lon: 2.3522},
		End:   domain.LatLon{Lat: 51.5074, Lon: -0.1278},
		Speed: 800,
	}}
	if err := eng.PlaySequence(context.Background(), legs, false); err != nil {
		t.Fatalf("PlaySequence: %v", err)
	}

	eng.simMu.Lock()
	running := eng.cancelSim != nil
	eng.simMu.Unlock()
	if !running {
		t.Error("PlaySequence did not start a simulation")
	}
}

func TestPlaySequenceRejectsAnEmptyJourney(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())

	err := eng.PlaySequence(context.Background(), nil, false)
	if err == nil {
		t.Fatal("PlaySequence accepted a journey with no legs")
	}
	if !strings.Contains(err.Error(), "no points") {
		t.Errorf("error = %v, want it to mention the missing points", err)
	}
}

func TestPatrolUpdateStartsAndStopsWandering(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	t.Cleanup(func() { _ = eng.StopRoute(context.Background()) })

	zone := domain.PatrolZone{
		Type:   "circle",
		Center: &domain.LatLon{Lat: 48.8566, Lon: 2.3522},
		Radius: 500,
		Active: true,
	}
	if err := eng.PatrolUpdate(context.Background(), zone); err != nil {
		t.Fatalf("PatrolUpdate(active): %v", err)
	}
	if st := eng.Status(); st.PatrolZone == nil || !st.PatrolZone.Active {
		t.Fatalf("patrol zone not reflected in status: %+v", eng.Status().PatrolZone)
	}
	eng.simMu.Lock()
	running := eng.cancelSim != nil
	eng.simMu.Unlock()
	if !running {
		t.Error("an active patrol did not start a simulation")
	}

	zone.Active = false
	if err := eng.PatrolUpdate(context.Background(), zone); err != nil {
		t.Fatalf("PatrolUpdate(inactive): %v", err)
	}
	eng.simMu.Lock()
	stillRunning := eng.cancelSim != nil
	eng.simMu.Unlock()
	if stillRunning {
		t.Error("deactivating the patrol left a simulation running")
	}
}

// Guards against a regression in the pause path: a paused simulation must not
// keep injecting positions.
func TestPausedSimulationStopsInjecting(t *testing.T) {
	drv := &mockDriver{id: domain.DriverPmd3}
	eng := New(drv, settings.Default())
	t.Cleanup(func() { _ = eng.StopRoute(context.Background()) })

	if err := eng.PlayCustomGpx(context.Background(), testGPX, 50); err != nil {
		t.Fatalf("PlayCustomGpx: %v", err)
	}
	if err := eng.PauseRoute(context.Background()); err != nil {
		t.Fatalf("PauseRoute: %v", err)
	}

	// Let any in-flight tick land, then take a baseline and confirm it holds.
	time.Sleep(150 * time.Millisecond)
	baseline := eng.Status().LastInjectedLocation
	time.Sleep(300 * time.Millisecond)
	after := eng.Status().LastInjectedLocation

	if baseline != nil && after != nil && (baseline.Lat != after.Lat || baseline.Lon != after.Lon) {
		t.Errorf("position moved while paused: %v -> %v", baseline, after)
	}
}

// Regression: stopping immediately after starting must win.
//
// startRouteSimulation writes State = "moving" and the sequence preview in its
// opening block. That goroutine may not have been scheduled yet when StopRoute
// runs, in which case it used to come along afterwards and undo the stop — and,
// its context already cancelled, never tick again to correct the status. The UI
// was then stuck on "moving" with a stale preview until something else
// refreshed it. Windows CI caught this as a flake in the test above; the loop
// makes it deterministic.
func TestStopImmediatelyAfterPlayIsNotUndoneByTheStartingSimulation(t *testing.T) {
	for range 50 {
		eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
		if err := eng.PlayCustomGpx(context.Background(), testGPX, 50); err != nil {
			t.Fatalf("PlayCustomGpx: %v", err)
		}
		if err := eng.StopRoute(context.Background()); err != nil {
			t.Fatalf("StopRoute: %v", err)
		}

		// Give the simulation goroutine every chance to run and clobber us.
		time.Sleep(2 * time.Millisecond)

		st := eng.Status()
		if st.State != "ready" {
			t.Fatalf("state = %q after an immediate stop, want ready", st.State)
		}
		if st.CurrentSequencePreview != nil {
			t.Fatal("the sequence preview survived an immediate stop")
		}
	}
}

// Same race on the patrol path, which has its own starting goroutine.
func TestStopImmediatelyAfterPatrolStartIsNotUndone(t *testing.T) {
	zone := domain.PatrolZone{
		Type:   "circle",
		Center: &domain.LatLon{Lat: 48.8566, Lon: 2.3522},
		Radius: 500,
		Active: true,
	}
	for range 50 {
		eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
		if err := eng.PatrolUpdate(context.Background(), zone); err != nil {
			t.Fatalf("PatrolUpdate: %v", err)
		}
		if err := eng.StopRoute(context.Background()); err != nil {
			t.Fatalf("StopRoute: %v", err)
		}

		time.Sleep(2 * time.Millisecond)

		if got := eng.Status().State; got != "ready" {
			t.Fatalf("state = %q after an immediate stop, want ready", got)
		}
	}
}
