package routing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

type OSRMProvider struct {
	baseURL string
}

func NewOSRMProvider(baseURL string) OSRMProvider {
	return OSRMProvider{baseURL: baseURL}
}

func (p OSRMProvider) Info() ProviderInfo {
	return ProviderInfo{
		ID:         ProviderOSRM,
		Name:       "OSRM",
		Available:  true,
		Configured: true,
		Profiles:   SupportedProfiles,
	}
}

func (p OSRMProvider) Route(ctx context.Context, req Request) ([]domain.LatLon, error) {
	baseURL := p.baseURL
	if baseURL == "" {
		baseURL = "http://router.project-osrm.org"
	}
	url := fmt.Sprintf("%s/route/v1/%s/%f,%f;%f,%f?overview=full&geometries=geojson",
		baseURL,
		osrmProfile(req.Profile),
		req.Start.Lon,
		req.Start.Lat,
		req.End.Lon,
		req.End.Lat,
	)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := HTTPClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bad status code: %d", resp.StatusCode)
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
		return nil, fmt.Errorf("no routes found")
	}
	return latLonFromGeoJSON(decoded.Routes[0].Geometry.Coordinates)
}

func osrmProfile(profile string) string {
	return NormalizeProfile(profile)
}
