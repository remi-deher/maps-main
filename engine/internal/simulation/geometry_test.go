package simulation

import (
	"math"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestDistance(t *testing.T) {
	cases := []struct {
		name string
		p1   domain.LatLon
		p2   domain.LatLon
		want float64
		tol  float64
	}{
		{"identical points", domain.LatLon{Lat: 48.8566, Lon: 2.3522}, domain.LatLon{Lat: 48.8566, Lon: 2.3522}, 0, 0.01},
		{"paris to lyon", domain.LatLon{Lat: 48.8566, Lon: 2.3522}, domain.LatLon{Lat: 45.7640, Lon: 4.8357}, 392000, 5000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Distance(c.p1, c.p2)
			if math.Abs(got-c.want) > c.tol {
				t.Errorf("Distance(%v, %v) = %.0fm, want %.0fm ± %.0fm", c.p1, c.p2, got, c.want, c.tol)
			}
		})
	}
}

func TestInterpolateTooShortPassthrough(t *testing.T) {
	single := []domain.LatLon{{Lat: 1, Lon: 1}}
	got := Interpolate(single, 50)
	if len(got) != 1 {
		t.Fatalf("expected passthrough for <2 points, got %d points", len(got))
	}
}

func TestInterpolateAddsIntermediateSteps(t *testing.T) {
	raw := []domain.LatLon{{Lat: 48.8566, Lon: 2.3522}, {Lat: 48.8656, Lon: 2.3522}}
	got := Interpolate(raw, 36)

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

func TestInterpolateDefaultsSpeedWhenZeroOrNegative(t *testing.T) {
	raw := []domain.LatLon{{Lat: 0, Lon: 0}, {Lat: 0.01, Lon: 0}}
	zero := Interpolate(raw, 0)
	neg := Interpolate(raw, -5)
	if len(zero) != len(neg) {
		t.Errorf("zero-speed and negative-speed interpolation diverged: %d vs %d points", len(zero), len(neg))
	}
	if len(zero) == 0 {
		t.Error("expected at least the start/end points")
	}
}

func TestInterpolateShortHopSkipsSteps(t *testing.T) {
	raw := []domain.LatLon{{Lat: 48.8566, Lon: 2.3522}, {Lat: 48.85661, Lon: 2.3522}}
	got := Interpolate(raw, 36)
	if len(got) != 2 {
		t.Errorf("expected exactly 2 points (start, end) for a sub-tick hop, got %d: %v", len(got), got)
	}
}
