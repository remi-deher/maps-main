package api

import (
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestSetLocationPayloadValidate(t *testing.T) {
	cases := []struct {
		name    string
		payload SetLocationPayload
		wantErr bool
	}{
		{"valid", SetLocationPayload{Lat: 48.8, Lon: 2.3, Name: "Paris"}, false},
		{"lat too high", SetLocationPayload{Lat: 91, Lon: 0}, true},
		{"lon too low", SetLocationPayload{Lat: 0, Lon: -181}, true},
		{"NaN lat", SetLocationPayload{Lat: nan(), Lon: 0}, true},
		{"name too long", SetLocationPayload{Lat: 0, Lon: 0, Name: strings.Repeat("a", maxNameLen+1)}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.payload.Validate()
			if (err != nil) != c.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, c.wantErr)
			}
		})
	}
}

func TestPlayRoutePayloadValidate(t *testing.T) {
	cases := []struct {
		name    string
		payload PlayRoutePayload
		wantErr bool
	}{
		{"valid", PlayRoutePayload{EndLat: 1, EndLon: 1, Speed: 50, Profile: "driving"}, false},
		{"zero speed means default", PlayRoutePayload{EndLat: 1, EndLon: 1, Speed: 0}, false},
		{"negative speed", PlayRoutePayload{EndLat: 1, EndLon: 1, Speed: -5}, true},
		{"speed too high", PlayRoutePayload{EndLat: 1, EndLon: 1, Speed: maxSpeedKmh + 1}, true},
		{"unknown profile", PlayRoutePayload{EndLat: 1, EndLon: 1, Profile: "teleport"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.payload.Validate()
			if (err != nil) != c.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, c.wantErr)
			}
		})
	}
}

func TestPlaySequencePayloadValidate(t *testing.T) {
	validLeg := domain.RouteLeg{Start: domain.LatLon{Lat: 1, Lon: 1}, End: domain.LatLon{Lat: 2, Lon: 2}}
	if err := (PlaySequencePayload{Legs: []domain.RouteLeg{validLeg}}).Validate(); err != nil {
		t.Errorf("expected valid legs to pass, got %v", err)
	}
	if err := (PlaySequencePayload{Legs: nil}).Validate(); err == nil {
		t.Error("expected empty legs to be rejected")
	}
	tooMany := make([]domain.RouteLeg, maxLegs+1)
	for i := range tooMany {
		tooMany[i] = validLeg
	}
	if err := (PlaySequencePayload{Legs: tooMany}).Validate(); err == nil {
		t.Error("expected too many legs to be rejected")
	}
	badLeg := domain.RouteLeg{Start: domain.LatLon{Lat: 999, Lon: 1}, End: domain.LatLon{Lat: 2, Lon: 2}}
	if err := (PlaySequencePayload{Legs: []domain.RouteLeg{badLeg}}).Validate(); err == nil {
		t.Error("expected an out-of-range leg coordinate to be rejected")
	}
}

func TestPlayCustomGpxPayloadValidate(t *testing.T) {
	if err := (PlayCustomGpxPayload{GpxContent: "<gpx/>"}).Validate(); err != nil {
		t.Errorf("expected non-empty content to pass, got %v", err)
	}
	if err := (PlayCustomGpxPayload{GpxContent: ""}).Validate(); err == nil {
		t.Error("expected empty content to be rejected")
	}
	if err := (PlayCustomGpxPayload{GpxContent: strings.Repeat("a", maxGpxLen+1)}).Validate(); err == nil {
		t.Error("expected oversized content to be rejected")
	}
}

func TestFavoritePayloadValidate(t *testing.T) {
	if err := (FavoritePayload{Lat: 1, Lon: 1, Name: "home"}).Validate(); err != nil {
		t.Errorf("expected valid favorite to pass, got %v", err)
	}
	if err := (FavoritePayload{Lat: 200, Lon: 1}).Validate(); err == nil {
		t.Error("expected out-of-range lat to be rejected")
	}
	if err := (FavoritePayload{Lat: 1, Lon: 1, NewName: strings.Repeat("a", maxNameLen+1)}).Validate(); err == nil {
		t.Error("expected an oversized newName to be rejected")
	}
}

func TestDebugLogPayloadValidate(t *testing.T) {
	if err := (DebugLogPayload{Message: "ok"}).Validate(); err != nil {
		t.Errorf("expected short message to pass, got %v", err)
	}
	if err := (DebugLogPayload{Message: strings.Repeat("a", maxMessageLen+1)}).Validate(); err == nil {
		t.Error("expected oversized message to be rejected")
	}
}

func TestPatrolUpdatePayloadValidate(t *testing.T) {
	circle := PatrolUpdatePayload{Zone: domain.PatrolZone{
		Type: "circle", Center: &domain.LatLon{Lat: 1, Lon: 1}, Radius: 500, Active: true,
	}}
	if err := circle.Validate(); err != nil {
		t.Errorf("expected valid circle zone to pass, got %v", err)
	}

	noCenter := PatrolUpdatePayload{Zone: domain.PatrolZone{Type: "circle", Radius: 500, Active: true}}
	if err := noCenter.Validate(); err == nil {
		t.Error("expected circle zone without center to be rejected")
	}

	badRadius := PatrolUpdatePayload{Zone: domain.PatrolZone{
		Type: "circle", Center: &domain.LatLon{Lat: 1, Lon: 1}, Radius: -1, Active: true,
	}}
	if err := badRadius.Validate(); err == nil {
		t.Error("expected a non-positive radius to be rejected")
	}

	rect := PatrolUpdatePayload{Zone: domain.PatrolZone{
		Type:   "rectangle",
		Bounds: &domain.PatrolBounds{NE: domain.LatLon{Lat: 2, Lon: 2}, SW: domain.LatLon{Lat: 1, Lon: 1}},
		Active: true,
	}}
	if err := rect.Validate(); err != nil {
		t.Errorf("expected valid rectangle zone to pass, got %v", err)
	}

	unknown := PatrolUpdatePayload{Zone: domain.PatrolZone{Type: "triangle", Active: true}}
	if err := unknown.Validate(); err == nil {
		t.Error("expected an unknown zone type to be rejected")
	}

	// A stop request (active: false) must always be accepted regardless of
	// geometry — the UI's "stop" button sends the zone type with center/bounds
	// left nil, since Engine.PatrolUpdate only needs Active to stop.
	stop := PatrolUpdatePayload{Zone: domain.PatrolZone{Type: "circle", Active: false}}
	if err := stop.Validate(); err != nil {
		t.Errorf("expected a stop request (active: false) to always pass, got %v", err)
	}
}

func nan() float64 {
	var zero float64
	return zero / zero
}
