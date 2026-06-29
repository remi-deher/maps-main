package engine

import (
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/routing"
)

func apiRoutingInfo(info routing.Info) api.RoutingInfo {
	providers := make([]api.RoutingProviderInfo, 0, len(info.Providers))
	for _, provider := range info.Providers {
		providers = append(providers, api.RoutingProviderInfo{
			ID:         provider.ID,
			Name:       provider.Name,
			Available:  provider.Available,
			Configured: provider.Configured,
			Profiles:   provider.Profiles,
		})
	}
	return api.RoutingInfo{
		Mode:               info.Mode,
		Provider:           info.Provider,
		ActiveProvider:     info.ActiveProvider,
		Priority:           info.Priority,
		AvailableProviders: info.AvailableProviders,
		Providers:          providers,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
