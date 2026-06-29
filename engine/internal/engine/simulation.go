package engine

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"os"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	sim "github.com/remi-deher/maps-main/engine/internal/simulation"
)

// defaultOsrmBaseURL is the OSRM routing server used for PlayRoute/
// PlaySequence previews when no value has been set from the web interface.
// Seeded from env for anyone self-hosting OSRM (rate limits / privacy /
// offline use); the live value is owned by the routing registry and editable
// at runtime via SaveSettings.
func defaultOsrmBaseURL() string {
	return strings.TrimSuffix(envOr("GPSMOCK_OSRM_BASE_URL", "http://router.project-osrm.org"), "/")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// startRouteSimulation starts a loop updating coordinates along a generated route path.
// speed is the km/h value used during interpolation, passed through to NavigationProgress.
func (e *Engine) startRouteSimulation(ctx context.Context, plan sim.Plan) {
	points := plan.Points
	if len(points) == 0 {
		return
	}

	// Broadcast sequence preview — must unlock before calling emit to avoid
	// deadlock if the emit callback (hub broadcast) re-enters the engine.
	e.mu.Lock()
	e.st.CurrentSequencePreview = make([]domain.SequencePoint, len(points))
	for i, p := range points {
		e.st.CurrentSequencePreview[i] = domain.SequencePoint{Lat: p.Lat, Lon: p.Lon}
	}
	e.st.State = "moving"
	e.st.Navigation.Status = &domain.NavigationStatus{
		State: "running",
		Index: 0,
		Total: len(points),
	}
	e.emitStatusLocked() // snapshots + unlocks e.mu before emitting

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	index := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if e.isPaused() {
				continue
			}
			if index >= len(points) {
				if plan.Looping {
					index = 0
				} else {
					e.mu.Lock()
					e.st.State = "ready"
					e.st.Navigation.Status = &domain.NavigationStatus{
						State: "stopped",
						Index: index,
						Total: len(points),
					}
					e.st.Navigation.Progress = nil
					e.st.CurrentSequencePreview = nil
					// Snapshot emit+status under lock, then release before emitting.
					emit, st := e.statusSnapshotLocked()
					emit(api.EventRouteFinished, api.RouteFinishedPayload{Timestamp: time.Now().UnixMilli()})
					emit(api.EventStatus, st)
					return
				}
			}

			p := points[index]

			// Apply Jitter/Noise if enabled
			e.mu.Lock()
			jitterEnabled := e.st.JitterEnabled
			if jitterEnabled {
				// Offset coordinates by ~0.5 to 1.5 meters randomly
				latOffset := (rand.Float64() - 0.5) * 0.00001
				lonOffset := (rand.Float64() - 0.5) * 0.00001
				p.Lat += latOffset
				p.Lon += lonOffset
			}
			e.mu.Unlock()

			// Inject location
			if err := e.simSetLocation(ctx, p.Lat, p.Lon, "Route simulation"); err != nil {
				e.LogEvent("error", "simulation", "location", "set", fmt.Sprintf("Erreur d'injection de position : %v", err), map[string]string{
					"lat":   fmt.Sprintf("%.6f", p.Lat),
					"lon":   fmt.Sprintf("%.6f", p.Lon),
					"error": err.Error(),
				})
			}

			e.mu.Lock()
			e.st.Navigation.Progress = &domain.NavigationProgress{
				Index: index,
				Total: len(points),
				Lat:   p.Lat,
				Lon:   p.Lon,
				Speed: plan.Speed, // actual interpolated speed in km/h
			}
			// simSetLocation above can block for several seconds (a slow/stuck
			// driver call) — if StopRoute ran concurrently while we were inside
			// it, Navigation.Status is now nil (it cancels ctx too, but only the
			// *next* loop iteration's select observes that; this one is already
			// past it). Without this guard the write below would be a nil
			// pointer dereference, panicking — and crashing — the whole engine.
			if e.st.Navigation.Status != nil {
				e.st.Navigation.Status.Index = index
			}
			e.emitStatusLocked() // snapshots + unlocks e.mu before emitting

			index++
		}
	}
}

// startPatrolSimulation continuously wanders the location inside the patrol zone
func (e *Engine) startPatrolSimulation(ctx context.Context, zone domain.PatrolZone) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	// Default starting position
	e.mu.Lock()
	currentPos := domain.LatLon{Lat: 48.8566, Lon: 2.3522}
	if e.st.LastInjectedLocation != nil {
		currentPos = domain.LatLon{Lat: e.st.LastInjectedLocation.Lat, Lon: e.st.LastInjectedLocation.Lon}
	}
	e.st.State = "moving"
	e.emitStatusLocked() // snapshots + unlocks e.mu before emitting

	var targetPos domain.LatLon
	hasTarget := false

	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			e.st.State = "ready"
			e.emitStatusLocked() // snapshots + unlocks e.mu before emitting
			return
		case <-ticker.C:
			if e.isPaused() {
				continue
			}
			// Pick new target if reached or not set
			if !hasTarget {
				if zone.Type == "circle" && zone.Center != nil {
					// Random angle and distance
					angle := rand.Float64() * 2 * math.Pi
					// sqrt(rand) ensures uniform distribution in circle
					radiusMeters := math.Sqrt(rand.Float64()) * zone.Radius
					if radiusMeters <= 0 {
						radiusMeters = 100.0
					}

					// 1 degree latitude ~ 111,000 meters
					latOffset := (radiusMeters * math.Cos(angle)) / 111000.0
					// 1 degree longitude ~ 111,000 * cos(lat) meters
					lonOffset := (radiusMeters * math.Sin(angle)) / (111000.0 * math.Cos(zone.Center.Lat*math.Pi/180.0))

					targetPos = domain.LatLon{
						Lat: zone.Center.Lat + latOffset,
						Lon: zone.Center.Lon + lonOffset,
					}
					hasTarget = true
				} else if zone.Type == "rectangle" && zone.Bounds != nil {
					// Random latitude between SW and NE
					minLat := math.Min(zone.Bounds.SW.Lat, zone.Bounds.NE.Lat)
					maxLat := math.Max(zone.Bounds.SW.Lat, zone.Bounds.NE.Lat)
					minLon := math.Min(zone.Bounds.SW.Lon, zone.Bounds.NE.Lon)
					maxLon := math.Max(zone.Bounds.SW.Lon, zone.Bounds.NE.Lon)

					targetPos = domain.LatLon{
						Lat: minLat + rand.Float64()*(maxLat-minLat),
						Lon: minLon + rand.Float64()*(maxLon-minLon),
					}
					hasTarget = true
				} else {
					// Fallback to wandering around current pos
					targetPos = domain.LatLon{
						Lat: currentPos.Lat + (rand.Float64()-0.5)*0.005,
						Lon: currentPos.Lon + (rand.Float64()-0.5)*0.005,
					}
					hasTarget = true
				}
			}

			// Move step towards targetPos
			dist := sim.Distance(currentPos, targetPos)
			speedMs := 5.0 / 3.6 // 5 km/h patrol speed
			if dist <= speedMs {
				currentPos = targetPos
				hasTarget = false // pick new target next tick
			} else {
				fraction := speedMs / dist
				currentPos.Lat = currentPos.Lat + (targetPos.Lat-currentPos.Lat)*fraction
				currentPos.Lon = currentPos.Lon + (targetPos.Lon-currentPos.Lon)*fraction
			}

			// Apply Jitter/Noise
			e.mu.Lock()
			jitterEnabled := e.st.JitterEnabled
			p := currentPos
			if jitterEnabled {
				latOffset := (rand.Float64() - 0.5) * 0.00001
				lonOffset := (rand.Float64() - 0.5) * 0.00001
				p.Lat += latOffset
				p.Lon += lonOffset
			}
			e.mu.Unlock()

			// Inject location
			if err := e.simSetLocation(ctx, p.Lat, p.Lon, "Patrol Mode"); err != nil {
				e.LogEvent("error", "simulation", "location", "set", fmt.Sprintf("Erreur d'injection de position : %v", err), map[string]string{
					"lat":   fmt.Sprintf("%.6f", p.Lat),
					"lon":   fmt.Sprintf("%.6f", p.Lon),
					"error": err.Error(),
				})
			}
		}
	}
}
