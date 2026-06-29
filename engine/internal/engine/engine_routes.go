package engine

import (
	"context"
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/routing"
	sim "github.com/remi-deher/maps-main/engine/internal/simulation"
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
	e.LogEvent("info", "simulation", "route", "stop", "Trajet arrêté", nil)
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
	e.LogEvent("info", "simulation", "route", "pause", "Trajet mis en pause", nil)
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
	e.LogEvent("info", "simulation", "route", "resume", "Trajet repris", nil)
	return nil
}

// isPaused reports whether the active simulation should skip this tick.
func (e *Engine) isPaused() bool {
	e.simMu.Lock()
	defer e.simMu.Unlock()
	return e.simPaused
}

// PlayRoute fetches a route from the configured routing provider and runs the
// movement simulation.
func (e *Engine) PlayRoute(ctx context.Context, endLat, lon float64, speed float64, profile string) error {
	e.stopActiveSimulation()
	e.LogEvent("info", "simulation", "route", "play", "Démarrage d'un trajet", map[string]string{
		"endLat":  fmt.Sprintf("%.6f", endLat),
		"endLon":  fmt.Sprintf("%.6f", lon),
		"speed":   fmt.Sprintf("%.2f", speed),
		"profile": routing.NormalizeProfile(profile),
	})

	e.mu.RLock()
	var start domain.LatLon
	if e.st.LastInjectedLocation != nil {
		start = domain.LatLon{Lat: e.st.LastInjectedLocation.Lat, Lon: e.st.LastInjectedLocation.Lon}
	} else {
		start = domain.LatLon{Lat: 48.8566, Lon: 2.3522} // Paris default
	}
	e.mu.RUnlock()

	end := domain.LatLon{Lat: endLat, Lon: lon}
	result, err := e.routingRegistry.Route(ctx, routing.Request{Start: start, End: end, Profile: profile})
	if err != nil {
		e.LogEvent("warn", "simulation", "route", "fallback", fmt.Sprintf("Aucun provider de routage disponible, trajet direct utilisé : %v", err), map[string]string{"error": err.Error()})
		result.Points = []domain.LatLon{start, end}
	} else {
		e.LogEvent("info", "routing", "provider", "selected", "Provider de routage selectionne", map[string]string{"provider": result.ProviderID})
	}

	plan, err := (sim.RoutePath{RawPoints: result.Points, SpeedKmh: speed}).Plan()
	if err != nil {
		return err
	}
	e.LogEvent("info", "simulation", "route", "prepared", fmt.Sprintf("Trajet prêt (%d points)", len(plan.Points)), map[string]string{
		"points": fmt.Sprintf("%d", len(plan.Points)),
	})

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, plan)
	return nil
}

// PlaySequence plays a multimodal journey of legs
func (e *Engine) PlaySequence(ctx context.Context, legs []domain.RouteLeg, looping bool) error {
	e.stopActiveSimulation()
	e.LogEvent("info", "simulation", "sequence", "play", fmt.Sprintf("Démarrage d'une séquence (%d segments)", len(legs)), map[string]string{
		"legs":    fmt.Sprintf("%d", len(legs)),
		"looping": fmt.Sprintf("%t", looping),
	})

	var allPoints []domain.LatLon
	for _, leg := range legs {
		switch leg.Type {
		case domain.LegDrive, domain.LegWalk:
			profile := "driving"
			if leg.Type == domain.LegWalk {
				profile = "walking"
			}
			result, err := e.routingRegistry.Route(ctx, routing.Request{Start: leg.Start, End: leg.End, Profile: profile})
			if err != nil {
				e.LogEvent("warn", "simulation", "sequence", "fallback", fmt.Sprintf("Aucun provider de routage disponible sur un segment, ligne directe utilisée : %v", err), map[string]string{"error": err.Error()})
				result.Points = []domain.LatLon{leg.Start, leg.End}
			} else {
				e.LogEvent("info", "routing", "provider", "selected", "Provider de routage selectionne pour un segment", map[string]string{
					"provider": result.ProviderID,
					"profile":  profile,
				})
			}
			plan, err := (sim.RoutePath{RawPoints: result.Points, SpeedKmh: leg.Speed}).Plan()
			if err != nil {
				return err
			}
			allPoints = append(allPoints, plan.Points...)
		case domain.LegFlight:
			rawPoints := []domain.LatLon{leg.Start, leg.End}
			plan, err := (sim.RoutePath{RawPoints: rawPoints, SpeedKmh: leg.Speed}).Plan()
			if err != nil {
				return err
			}
			allPoints = append(allPoints, plan.Points...)
		}
	}

	if len(allPoints) == 0 {
		err := fmt.Errorf("no points to play")
		e.LogEvent("error", "simulation", "sequence", "play", "Séquence vide : aucun point à jouer", map[string]string{"error": err.Error()})
		return err
	}
	e.LogEvent("info", "simulation", "sequence", "prepared", fmt.Sprintf("Séquence prête (%d points)", len(allPoints)), map[string]string{
		"points": fmt.Sprintf("%d", len(allPoints)),
	})

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, sim.Plan{Points: allPoints, Looping: looping, Speed: 0}) // speed per-leg, not uniform
	return nil
}

// PlayCustomGpx parses the GPX content and plays the route
func (e *Engine) PlayCustomGpx(ctx context.Context, gpxContent string, speedKmh float64) error {
	e.stopActiveSimulation()
	e.LogEvent("info", "simulation", "gpx", "play", "Démarrage d'un GPX", map[string]string{
		"speed": fmt.Sprintf("%.2f", speedKmh),
	})

	rawPoints := sim.ParseGPXCoordinates(gpxContent)
	plan, err := (sim.GPX{Content: gpxContent, SpeedKmh: speedKmh}).Plan()
	if err != nil {
		return err
	}
	if len(rawPoints) == 0 {
		err := fmt.Errorf("no GPX points parsed")
		e.LogEvent("error", "simulation", "gpx", "parse", "Aucun point GPX lisible", map[string]string{"error": err.Error()})
		return err
	}

	e.LogEvent("info", "simulation", "gpx", "prepared", fmt.Sprintf("GPX prêt (%d points)", len(plan.Points)), map[string]string{
		"rawPoints": fmt.Sprintf("%d", len(rawPoints)),
		"points":    fmt.Sprintf("%d", len(plan.Points)),
	})

	simCtx, cancel := context.WithCancel(context.Background())
	e.simMu.Lock()
	e.cancelSim = cancel
	e.simMu.Unlock()

	go e.startRouteSimulation(simCtx, plan)
	return nil
}

// PatrolUpdate sets/toggles the patrol zone and starts/stops simulated wandering
func (e *Engine) PatrolUpdate(ctx context.Context, zone domain.PatrolZone) error {
	e.stopActiveSimulation()

	e.mu.Lock()
	e.st.PatrolZone = &zone
	e.emitStatusLocked()

	if zone.Active {
		e.LogEvent("info", "simulation", "patrol", "start", "Patrouille démarrée", map[string]string{
			"type": zone.Type,
		})
		simCtx, cancel := context.WithCancel(context.Background())
		e.simMu.Lock()
		e.cancelSim = cancel
		e.simMu.Unlock()

		go e.startPatrolSimulation(simCtx, zone)
	} else {
		e.LogEvent("info", "simulation", "patrol", "stop", "Patrouille arrêtée", nil)
	}

	return nil
}
