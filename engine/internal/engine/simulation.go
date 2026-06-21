package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// OSRM response wrapper
type osrmResponse struct {
	Routes []struct {
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"routes"`
}

// fetchOSRMRoute queries the project-osrm.org routing API
func fetchOSRMRoute(start, end domain.LatLon, profile string) ([]domain.LatLon, error) {
	if profile == "" {
		profile = "driving"
	}
	url := fmt.Sprintf("http://router.project-osrm.org/route/v1/%s/%f,%f;%f,%f?overview=full&geometries=geojson",
		profile, start.Lon, start.Lat, end.Lon, end.Lat)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bad status code: %d", resp.StatusCode)
	}

	var data osrmResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	if len(data.Routes) == 0 || len(data.Routes[0].Geometry.Coordinates) == 0 {
		return nil, fmt.Errorf("no routes found")
	}

	var points []domain.LatLon
	for _, coord := range data.Routes[0].Geometry.Coordinates {
		if len(coord) >= 2 {
			points = append(points, domain.LatLon{Lat: coord[1], Lon: coord[0]})
		}
	}

	return points, nil
}

// haversineDistance returns distance in meters between two coordinates
func haversineDistance(p1, p2 domain.LatLon) float64 {
	const earthRadius = 6371000.0 // meters
	dLat := (p2.Lat - p1.Lat) * math.Pi / 180.0
	dLon := (p2.Lon - p1.Lon) * math.Pi / 180.0
	lat1 := p1.Lat * math.Pi / 180.0
	lat2 := p2.Lat * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1)*math.Cos(lat2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadius * c
}

// interpolatePoints builds intermediate points along a route to match speed
func interpolatePoints(rawPoints []domain.LatLon, speedKmh float64) []domain.LatLon {
	if len(rawPoints) < 2 {
		return rawPoints
	}
	if speedKmh <= 0 {
		speedKmh = 15.0
	}

	// 1 second tick interval speed in meters
	speedMs := speedKmh / 3.6

	var interpolated []domain.LatLon
	interpolated = append(interpolated, rawPoints[0])

	for i := 0; i < len(rawPoints)-1; i++ {
		p1 := rawPoints[i]
		p2 := rawPoints[i+1]
		dist := haversineDistance(p1, p2)

		if dist <= speedMs {
			interpolated = append(interpolated, p2)
			continue
		}

		steps := int(math.Floor(dist / speedMs))
		for s := 1; s <= steps; s++ {
			fraction := float64(s) / (dist / speedMs)
			lat := p1.Lat + (p2.Lat-p1.Lat)*fraction
			lon := p1.Lon + (p2.Lon-p1.Lon)*fraction
			interpolated = append(interpolated, domain.LatLon{Lat: lat, Lon: lon})
		}
		interpolated = append(interpolated, p2)
	}

	return interpolated
}

// startRouteSimulation starts a loop updating coordinates along a generated route path
func (e *Engine) startRouteSimulation(ctx context.Context, points []domain.LatLon, looping bool) {
	if len(points) == 0 {
		return
	}

	// Broadcast sequence preview
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
	e.emit(api.EventStatus, e.st)
	e.mu.Unlock()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	index := 0
	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			e.st.State = "ready"
			e.st.Navigation.Status = &domain.NavigationStatus{
				State: "stopped",
				Index: index,
				Total: len(points),
			}
			e.emit(api.EventStatus, e.st)
			e.mu.Unlock()
			return
		case <-ticker.C:
			if e.isPaused() {
				continue
			}
			if index >= len(points) {
				if looping {
					index = 0
				} else {
					e.mu.Lock()
					e.st.State = "ready"
					e.st.Navigation.Status = &domain.NavigationStatus{
						State: "stopped",
						Index: index,
						Total: len(points),
					}
					e.emit(api.EventRouteFinished, api.RouteFinishedPayload{Timestamp: time.Now().UnixMilli()})
					e.emit(api.EventStatus, e.st)
					e.mu.Unlock()
					return
				}
			}

			p := points[index]

			// Apply Jitter/Noise if enabled
			e.mu.Lock()
			// Check settings or enable by default for demo
			jitterEnabled := true // Fallback to true or use status settings
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
				fmt.Printf("Error injecting location: %v\n", err)
			}

			e.mu.Lock()
			e.st.Navigation.Progress = &domain.NavigationProgress{
				Index: index,
				Total: len(points),
				Lat:   p.Lat,
				Lon:   p.Lon,
				Speed: 15.0, // Mock speed
			}
			e.st.Navigation.Status.Index = index
			e.emit(api.EventStatus, e.st)
			e.mu.Unlock()

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
	e.emit(api.EventStatus, e.st)
	e.mu.Unlock()

	var targetPos domain.LatLon
	hasTarget := false

	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			e.st.State = "ready"
			e.emit(api.EventStatus, e.st)
			e.mu.Unlock()
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
			dist := haversineDistance(currentPos, targetPos)
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
			jitterEnabled := true
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
				fmt.Printf("Error injecting location: %v\n", err)
			}
		}
	}
}

// Simple GPX coordinate extraction using regular expressions
func parseGPXCoordinates(gpxContent string) []domain.LatLon {
	var points []domain.LatLon

	// Support matching both single and double quotes for lat/lon in trkpt
	latRegex := regexp.MustCompile(`lat=["'](-?\d+\.?\d*)["']`)
	lonRegex := regexp.MustCompile(`lon=["'](-?\d+\.?\d*)["']`)

	// Split by trkpt tags
	trkptRegex := regexp.MustCompile(`<trkpt\s+[^>]*>`)
	matches := trkptRegex.FindAllString(gpxContent, -1)

	for _, match := range matches {
		latMatch := latRegex.FindStringSubmatch(match)
		lonMatch := lonRegex.FindStringSubmatch(match)
		if len(latMatch) >= 2 && len(lonMatch) >= 2 {
			lat, err1 := strconv.ParseFloat(latMatch[1], 64)
			lon, err2 := strconv.ParseFloat(lonMatch[1], 64)
			if err1 == nil && err2 == nil {
				points = append(points, domain.LatLon{Lat: lat, Lon: lon})
			}
		}
	}
	return points
}
