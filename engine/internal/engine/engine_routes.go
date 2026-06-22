package engine

import (
	"context"
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

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
	e.emitStatusLocked()
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
	e.emitStatusLocked()
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
	e.emitStatusLocked()
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
	rawPoints, err := fetchOSRMRoute(e.osrmURL(), start, end, profile)
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
		switch leg.Type {
		case domain.LegDrive, domain.LegWalk:
			profile := "driving"
			if leg.Type == domain.LegWalk {
				profile = "foot"
			}
			rawPoints, err := fetchOSRMRoute(e.osrmURL(), leg.Start, leg.End, profile)
			if err != nil {
				rawPoints = []domain.LatLon{leg.Start, leg.End}
			}
			points := interpolatePoints(rawPoints, leg.Speed)
			allPoints = append(allPoints, points...)
		case domain.LegFlight:
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
	e.emitStatusLocked()

	if zone.Active {
		simCtx, cancel := context.WithCancel(context.Background())
		e.simMu.Lock()
		e.cancelSim = cancel
		e.simMu.Unlock()

		go e.startPatrolSimulation(simCtx, zone)
	}

	return nil
}
