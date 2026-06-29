package routing

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

type Registry struct {
	mu        sync.RWMutex
	cfg       Config
	providers map[string]Provider
}

func NewRegistry(cfg Config) *Registry {
	cfg = NormalizeConfig(cfg)
	r := &Registry{
		cfg:       cfg,
		providers: buildProviders(cfg),
	}
	return r
}

func (r *Registry) UpdateConfig(cfg Config) {
	cfg = NormalizeConfig(cfg)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cfg = cfg
	r.providers = buildProviders(cfg)
}

func (r *Registry) Config() Config {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return cloneConfig(r.cfg)
}

func (r *Registry) Info() Info {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return buildInfo(r.cfg, r.providerInfosLocked())
}

func (r *Registry) Route(ctx context.Context, req Request) (Result, error) {
	r.mu.RLock()
	cfg := cloneConfig(r.cfg)
	providers := make(map[string]Provider, len(r.providers))
	for id, provider := range r.providers {
		providers[id] = provider
	}
	r.mu.RUnlock()

	req.Profile = NormalizeProfile(req.Profile)
	var errs []string
	for _, id := range providerOrder(cfg) {
		provider, ok := providers[id]
		if !ok {
			continue
		}
		info := provider.Info()
		if !info.Available {
			continue
		}
		points, err := provider.Route(ctx, req)
		if err == nil && len(points) > 0 {
			return Result{ProviderID: info.ID, Points: points}, nil
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", info.ID, err))
		}
	}
	return Result{}, fmt.Errorf("all routing providers failed (%s)", strings.Join(errs, "; "))
}

func (r *Registry) providerInfosLocked() []ProviderInfo {
	infos := make([]ProviderInfo, 0, len(DefaultPriority))
	for _, id := range DefaultPriority {
		if provider, ok := r.providers[id]; ok {
			infos = append(infos, provider.Info())
		}
	}
	return infos
}

func buildInfo(cfg Config, providers []ProviderInfo) Info {
	available := map[string]bool{}
	var availableIDs []string
	for _, provider := range providers {
		if provider.Available {
			available[provider.ID] = true
			availableIDs = append(availableIDs, provider.ID)
		}
	}

	active := ""
	if cfg.Mode == ModeManual && available[cfg.Provider] {
		active = cfg.Provider
	} else {
		for _, id := range NormalizePriority(cfg.ProviderPriority) {
			if available[id] {
				active = id
				break
			}
		}
	}
	if active == "" {
		active = ProviderOSRM
	}

	return Info{
		Mode:               cfg.Mode,
		Provider:           cfg.Provider,
		ActiveProvider:     active,
		Priority:           NormalizePriority(cfg.ProviderPriority),
		AvailableProviders: availableIDs,
		Providers:          providers,
	}
}

func providerOrder(cfg Config) []string {
	var order []string
	if cfg.Mode == ModeManual && cfg.Provider != "" {
		order = append(order, cfg.Provider)
	}
	order = append(order, NormalizePriority(cfg.ProviderPriority)...)

	seen := map[string]bool{}
	var out []string
	for _, id := range order {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func NormalizeConfig(cfg Config) Config {
	cfg.Mode = NormalizeMode(cfg.Mode)
	cfg.Provider = NormalizeProviderID(cfg.Provider)
	cfg.ProviderPriority = NormalizePriority(cfg.ProviderPriority)
	cfg.OSRMBaseURL = strings.TrimSuffix(strings.TrimSpace(cfg.OSRMBaseURL), "/")
	cfg.GoogleRoutesAPIKey = strings.TrimSpace(cfg.GoogleRoutesAPIKey)
	cfg.MapboxAccessToken = strings.TrimSpace(cfg.MapboxAccessToken)
	return cfg
}

func NormalizeMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case ModeManual:
		return ModeManual
	default:
		return ModeAuto
	}
}

func NormalizeProviderID(id string) string {
	switch strings.ToLower(strings.TrimSpace(id)) {
	case ProviderGoogle:
		return ProviderGoogle
	case ProviderMapbox:
		return ProviderMapbox
	default:
		return ProviderOSRM
	}
}

func NormalizePriority(priority []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, raw := range priority {
		id := NormalizeProviderID(raw)
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	for _, id := range DefaultPriority {
		if !seen[id] {
			out = append(out, id)
		}
	}
	return out
}

func NormalizeProfile(profile string) string {
	switch strings.ToLower(strings.TrimSpace(profile)) {
	case "walk", "foot", "walking":
		return "walking"
	case "bike", "bicycle", "cycling":
		return "cycling"
	default:
		return "driving"
	}
}

func cloneConfig(cfg Config) Config {
	cfg.ProviderPriority = append([]string(nil), cfg.ProviderPriority...)
	return cfg
}

func buildProviders(cfg Config) map[string]Provider {
	return map[string]Provider{
		ProviderOSRM:   NewOSRMProvider(cfg.OSRMBaseURL),
		ProviderGoogle: NewGoogleProvider(cfg.GoogleRoutesAPIKey),
		ProviderMapbox: NewMapboxProvider(cfg.MapboxAccessToken),
	}
}
