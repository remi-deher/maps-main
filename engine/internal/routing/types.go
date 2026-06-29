package routing

import (
	"context"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

const (
	ProviderOSRM   = "osrm"
	ProviderGoogle = "google"
	ProviderMapbox = "mapbox"

	ModeAuto   = "auto"
	ModeManual = "manual"
)

var DefaultPriority = []string{ProviderGoogle, ProviderMapbox, ProviderOSRM}
var SupportedProfiles = []string{"driving", "walking", "cycling"}

type Config struct {
	OSRMBaseURL        string
	Mode               string
	Provider           string
	ProviderPriority   []string
	GoogleRoutesAPIKey string
	MapboxAccessToken  string
}

type Request struct {
	Start   domain.LatLon
	End     domain.LatLon
	Profile string
}

type Result struct {
	ProviderID string
	Points     []domain.LatLon
}

type ProviderInfo struct {
	ID         string
	Name       string
	Available  bool
	Configured bool
	Profiles   []string
}

type Info struct {
	Mode               string
	Provider           string
	ActiveProvider     string
	Priority           []string
	AvailableProviders []string
	Providers          []ProviderInfo
}

type Provider interface {
	Info() ProviderInfo
	Route(ctx context.Context, req Request) ([]domain.LatLon, error)
}
