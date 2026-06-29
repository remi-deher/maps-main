package routing

import "testing"

func TestRegistryInfoUsesFirstAvailablePriorityProvider(t *testing.T) {
	registry := NewRegistry(Config{
		OSRMBaseURL:       "http://router.project-osrm.org",
		Mode:              ModeAuto,
		Provider:          ProviderGoogle,
		ProviderPriority:  []string{ProviderGoogle, ProviderMapbox, ProviderOSRM},
		MapboxAccessToken: "mapbox-token",
	})
	info := registry.Info()

	if info.ActiveProvider != ProviderMapbox {
		t.Fatalf("expected mapbox active provider, got %q", info.ActiveProvider)
	}
	if len(info.AvailableProviders) != 2 {
		t.Fatalf("expected mapbox and osrm to be available, got %v", info.AvailableProviders)
	}
	if info.Providers[0].Available {
		t.Fatalf("expected google to be unavailable without an API key")
	}
}

func TestRegistryInfoFallsBackWhenManualProviderUnavailable(t *testing.T) {
	registry := NewRegistry(Config{
		OSRMBaseURL:      "http://router.project-osrm.org",
		Mode:             ModeManual,
		Provider:         ProviderGoogle,
		ProviderPriority: []string{ProviderGoogle, ProviderOSRM},
	})
	info := registry.Info()

	if info.ActiveProvider != ProviderOSRM {
		t.Fatalf("expected osrm fallback, got %q", info.ActiveProvider)
	}
}

func TestDecodeEncodedPolyline(t *testing.T) {
	points, err := decodeEncodedPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
	if err != nil {
		t.Fatalf("decode polyline: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("expected 3 points, got %d", len(points))
	}
	if points[0].Lat != 38.5 || points[0].Lon != -120.2 {
		t.Fatalf("unexpected first point: %+v", points[0])
	}
}
