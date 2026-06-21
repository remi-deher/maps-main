package engine

import (
	"math"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestHaversineDistance(t *testing.T) {
	cases := []struct {
		name string
		p1   domain.LatLon
		p2   domain.LatLon
		want float64
		tol  float64
	}{
		{"identical points", domain.LatLon{Lat: 48.8566, Lon: 2.3522}, domain.LatLon{Lat: 48.8566, Lon: 2.3522}, 0, 0.01},
		// Paris -> Lyon is ~392km great-circle.
		{"paris to lyon", domain.LatLon{Lat: 48.8566, Lon: 2.3522}, domain.LatLon{Lat: 45.7640, Lon: 4.8357}, 392000, 5000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := haversineDistance(c.p1, c.p2)
			if math.Abs(got-c.want) > c.tol {
				t.Errorf("haversineDistance(%v, %v) = %.0fm, want %.0fm ± %.0fm", c.p1, c.p2, got, c.want, c.tol)
			}
		})
	}
}

func TestInterpolatePointsTooShortPassthrough(t *testing.T) {
	single := []domain.LatLon{{Lat: 1, Lon: 1}}
	got := interpolatePoints(single, 50)
	if len(got) != 1 {
		t.Fatalf("expected passthrough for <2 points, got %d points", len(got))
	}
}

func TestInterpolatePointsAddsIntermediateSteps(t *testing.T) {
	// ~1.1km apart (roughly 0.01 deg latitude); at 36km/h (=10m/s) this should
	// produce multiple 10m-spaced intermediate points, not just start/end.
	raw := []domain.LatLon{{Lat: 48.8566, Lon: 2.3522}, {Lat: 48.8656, Lon: 2.3522}}
	got := interpolatePoints(raw, 36)

	if len(got) < 3 {
		t.Fatalf("expected several interpolated points for a ~1.1km leg, got %d", len(got))
	}
	if got[0] != raw[0] {
		t.Errorf("first point = %v, want start %v", got[0], raw[0])
	}
	if last := got[len(got)-1]; last != raw[len(raw)-1] {
		t.Errorf("last point = %v, want end %v", last, raw[len(raw)-1])
	}
}

func TestInterpolatePointsDefaultsSpeedWhenZeroOrNegative(t *testing.T) {
	raw := []domain.LatLon{{Lat: 0, Lon: 0}, {Lat: 0.01, Lon: 0}}
	zero := interpolatePoints(raw, 0)
	neg := interpolatePoints(raw, -5)
	// Both should fall back to the same default (15km/h) and thus produce an
	// identical number of points.
	if len(zero) != len(neg) {
		t.Errorf("zero-speed and negative-speed interpolation diverged: %d vs %d points", len(zero), len(neg))
	}
	if len(zero) == 0 {
		t.Error("expected at least the start/end points")
	}
}

func TestInterpolatePointsShortHopSkipsSteps(t *testing.T) {
	// Two points closer together than one tick's travel distance: no
	// intermediate steps should be inserted, just start then end.
	raw := []domain.LatLon{{Lat: 48.8566, Lon: 2.3522}, {Lat: 48.85661, Lon: 2.3522}}
	got := interpolatePoints(raw, 36)
	if len(got) != 2 {
		t.Errorf("expected exactly 2 points (start, end) for a sub-tick hop, got %d: %v", len(got), got)
	}
}

func TestParseGPXCoordinates(t *testing.T) {
	gpx := `<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="48.8566" lon="2.3522"></trkpt>
<trkpt lat='45.7640' lon='4.8357'></trkpt>
</trkseg></trk></gpx>`

	got := parseGPXCoordinates(gpx)
	want := []domain.LatLon{{Lat: 48.8566, Lon: 2.3522}, {Lat: 45.7640, Lon: 4.8357}}
	if len(got) != len(want) {
		t.Fatalf("got %d points, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("point[%d] = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestParseGPXCoordinatesNoTrkptReturnsEmpty(t *testing.T) {
	if got := parseGPXCoordinates("<gpx></gpx>"); len(got) != 0 {
		t.Errorf("expected no points for GPX without trkpt, got %d", len(got))
	}
}

func TestParseGPXCoordinatesMalformedAttributesAreSkipped(t *testing.T) {
	gpx := `<trkpt lat="not-a-number" lon="2.3522"></trkpt>`
	if got := parseGPXCoordinates(gpx); len(got) != 0 {
		t.Errorf("expected malformed lat/lon to be skipped, got %d points", len(got))
	}
}
