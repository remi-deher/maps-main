package api

import (
	"fmt"
	"math"
)

// Bounds applied to inbound WebSocket payloads. The engine has no
// authentication on its own (it trusts the LAN it runs on), so this isn't a
// security boundary — it's a sanity boundary, rejecting the kind of garbage
// a buggy client or a fuzzed message could otherwise push deep into engine
// state (NaN coordinates, a negative speed, a megabyte-long favorite name).
const (
	maxSpeedKmh   = 2000 // generous upper bound; nothing legitimate plays faster
	maxNameLen    = 200
	maxMessageLen = 4000
	maxGpxLen     = 16 * 1024 * 1024 // mirrors server.maxWSMessageBytes
	maxLegs       = 500
	maxRadiusM    = 1_000_000 // 1000km patrol radius is already absurd
)

func validLatLon(lat, lon float64) error {
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) {
		return fmt.Errorf("lat/lon must be finite numbers")
	}
	if lat < -90 || lat > 90 {
		return fmt.Errorf("lat %g out of range [-90, 90]", lat)
	}
	if lon < -180 || lon > 180 {
		return fmt.Errorf("lon %g out of range [-180, 180]", lon)
	}
	return nil
}

func validSpeed(speed float64) error {
	if speed == 0 {
		return nil // 0 means "use the engine default", handled downstream
	}
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed < 0 || speed > maxSpeedKmh {
		return fmt.Errorf("speed %g out of range (0, %d]", speed, maxSpeedKmh)
	}
	return nil
}

func validName(name string) error {
	if len(name) > maxNameLen {
		return fmt.Errorf("name longer than %d characters", maxNameLen)
	}
	return nil
}

// Validate checks SET_LOCATION's payload.
func (p SetLocationPayload) Validate() error {
	if err := validLatLon(p.Lat, p.Lon); err != nil {
		return err
	}
	return validName(p.Name)
}

// Validate checks PLAY_ROUTE / PLAY_OSRM_ROUTE's payload.
func (p PlayRoutePayload) Validate() error {
	if err := validLatLon(p.EndLat, p.EndLon); err != nil {
		return err
	}
	if err := validSpeed(p.Speed); err != nil {
		return err
	}
	switch p.Profile {
	case "", "driving", "walking", "cycling":
	default:
		return fmt.Errorf("unknown profile %q", p.Profile)
	}
	return nil
}

// Validate checks PLAY_SEQUENCE's payload.
func (p PlaySequencePayload) Validate() error {
	if len(p.Legs) == 0 {
		return fmt.Errorf("legs must not be empty")
	}
	if len(p.Legs) > maxLegs {
		return fmt.Errorf("too many legs (%d > %d)", len(p.Legs), maxLegs)
	}
	for i, leg := range p.Legs {
		if err := validLatLon(leg.Start.Lat, leg.Start.Lon); err != nil {
			return fmt.Errorf("leg %d start: %w", i, err)
		}
		if err := validLatLon(leg.End.Lat, leg.End.Lon); err != nil {
			return fmt.Errorf("leg %d end: %w", i, err)
		}
		if err := validSpeed(leg.Speed); err != nil {
			return fmt.Errorf("leg %d: %w", i, err)
		}
	}
	return nil
}

// Validate checks PLAY_CUSTOM_GPX's payload.
func (p PlayCustomGpxPayload) Validate() error {
	if p.GpxContent == "" {
		return fmt.Errorf("gpxContent must not be empty")
	}
	if len(p.GpxContent) > maxGpxLen {
		return fmt.Errorf("gpxContent longer than %d bytes", maxGpxLen)
	}
	return validSpeed(p.Speed)
}

// Validate checks ADD_FAVORITE / REMOVE_FAVORITE / RENAME_FAVORITE's payload.
func (p FavoritePayload) Validate() error {
	if err := validLatLon(p.Lat, p.Lon); err != nil {
		return err
	}
	if err := validName(p.Name); err != nil {
		return err
	}
	return validName(p.NewName)
}

// Validate checks REAL_LOCATION's payload.
func (p RealLocationPayload) Validate() error {
	return validLatLon(p.Latitude, p.Longitude)
}

// Validate checks DEBUG_LOG's payload.
func (p DebugLogPayload) Validate() error {
	if len(p.Message) > maxMessageLen {
		return fmt.Errorf("message longer than %d characters", maxMessageLen)
	}
	return nil
}

// Validate checks PATROL_UPDATE's payload.
func (p PatrolUpdatePayload) Validate() error {
	z := p.Zone
	switch z.Type {
	case "circle":
		if z.Center == nil {
			return fmt.Errorf("circle zone requires a center")
		}
		if err := validLatLon(z.Center.Lat, z.Center.Lon); err != nil {
			return err
		}
		if z.Radius <= 0 || z.Radius > maxRadiusM {
			return fmt.Errorf("radius %g out of range (0, %d]", z.Radius, maxRadiusM)
		}
	case "rectangle":
		if z.Bounds == nil {
			return fmt.Errorf("rectangle zone requires bounds")
		}
		if err := validLatLon(z.Bounds.NE.Lat, z.Bounds.NE.Lon); err != nil {
			return err
		}
		if err := validLatLon(z.Bounds.SW.Lat, z.Bounds.SW.Lon); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown zone type %q", z.Type)
	}
	return nil
}
