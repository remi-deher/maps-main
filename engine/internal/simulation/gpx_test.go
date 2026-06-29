package simulation

import (
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestParseGPXCoordinates(t *testing.T) {
	gpx := `<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="48.8566" lon="2.3522"></trkpt>
<trkpt lat='45.7640' lon='4.8357'></trkpt>
</trkseg></trk></gpx>`

	got := ParseGPXCoordinates(gpx)
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
	if got := ParseGPXCoordinates("<gpx></gpx>"); len(got) != 0 {
		t.Errorf("expected no points for GPX without trkpt, got %d", len(got))
	}
}

func TestParseGPXCoordinatesMalformedAttributesAreSkipped(t *testing.T) {
	gpx := `<trkpt lat="not-a-number" lon="2.3522"></trkpt>`
	if got := ParseGPXCoordinates(gpx); len(got) != 0 {
		t.Errorf("expected malformed lat/lon to be skipped, got %d points", len(got))
	}
}
