package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

type GoogleProvider struct {
	apiKey string
}

func NewGoogleProvider(apiKey string) GoogleProvider {
	return GoogleProvider{apiKey: strings.TrimSpace(apiKey)}
}

func (p GoogleProvider) Info() ProviderInfo {
	configured := p.apiKey != ""
	return ProviderInfo{
		ID:         ProviderGoogle,
		Name:       "Google Routes",
		Available:  configured,
		Configured: configured,
		Profiles:   SupportedProfiles,
	}
}

func (p GoogleProvider) Route(ctx context.Context, req Request) ([]domain.LatLon, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("google routes api key missing")
	}

	body := map[string]any{
		"origin": map[string]any{
			"location": map[string]any{
				"latLng": map[string]float64{"latitude": req.Start.Lat, "longitude": req.Start.Lon},
			},
		},
		"destination": map[string]any{
			"location": map[string]any{
				"latLng": map[string]float64{"latitude": req.End.Lat, "longitude": req.End.Lon},
			},
		},
		"travelMode":       googleTravelMode(req.Profile),
		"polylineQuality":  "HIGH_QUALITY",
		"polylineEncoding": "ENCODED_POLYLINE",
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://routes.googleapis.com/directions/v2:computeRoutes", bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Goog-Api-Key", p.apiKey)
	httpReq.Header.Set("X-Goog-FieldMask", "routes.polyline.encodedPolyline")

	resp, err := HTTPClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("google routes status %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var decoded struct {
		Routes []struct {
			Polyline struct {
				EncodedPolyline string `json:"encodedPolyline"`
			} `json:"polyline"`
		} `json:"routes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}
	if len(decoded.Routes) == 0 || decoded.Routes[0].Polyline.EncodedPolyline == "" {
		return nil, fmt.Errorf("google routes returned no geometry")
	}
	return decodeEncodedPolyline(decoded.Routes[0].Polyline.EncodedPolyline)
}

func googleTravelMode(profile string) string {
	switch NormalizeProfile(profile) {
	case "walking":
		return "WALK"
	case "cycling":
		return "BICYCLE"
	default:
		return "DRIVE"
	}
}
