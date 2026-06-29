package routing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

type MapboxProvider struct {
	accessToken string
}

func NewMapboxProvider(accessToken string) MapboxProvider {
	return MapboxProvider{accessToken: strings.TrimSpace(accessToken)}
}

func (p MapboxProvider) Info() ProviderInfo {
	configured := p.accessToken != ""
	return ProviderInfo{
		ID:         ProviderMapbox,
		Name:       "Mapbox",
		Available:  configured,
		Configured: configured,
		Profiles:   SupportedProfiles,
	}
}

func (p MapboxProvider) Route(ctx context.Context, req Request) ([]domain.LatLon, error) {
	if p.accessToken == "" {
		return nil, fmt.Errorf("mapbox access token missing")
	}

	endpoint := fmt.Sprintf(
		"https://api.mapbox.com/directions/v5/%s/%f,%f;%f,%f",
		mapboxProfile(req.Profile),
		req.Start.Lon,
		req.Start.Lat,
		req.End.Lon,
		req.End.Lat,
	)
	components, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	q := components.Query()
	q.Set("overview", "full")
	q.Set("geometries", "geojson")
	q.Set("access_token", p.accessToken)
	components.RawQuery = q.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, components.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := HTTPClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("mapbox directions status %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var decoded struct {
		Routes []struct {
			Geometry struct {
				Coordinates [][]float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"routes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}
	if len(decoded.Routes) == 0 || len(decoded.Routes[0].Geometry.Coordinates) == 0 {
		return nil, fmt.Errorf("mapbox directions returned no geometry")
	}
	return latLonFromGeoJSON(decoded.Routes[0].Geometry.Coordinates)
}

func mapboxProfile(profile string) string {
	switch NormalizeProfile(profile) {
	case "walking":
		return "mapbox/walking"
	case "cycling":
		return "mapbox/cycling"
	default:
		return "mapbox/driving"
	}
}
