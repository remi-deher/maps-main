package settings

import "github.com/remi-deher/maps-main/engine/internal/domain"

// RuntimeConfig is the subset of persisted settings the engine needs while
// running. It keeps legacy/storage-only fields out of the engine constructor
// without forcing a settings schema migration.
type RuntimeConfig struct {
	CompanionPort int

	PreferredDriver domain.DriverID
	UsbDriver       domain.DriverID
	WifiDriver      domain.DriverID
	FallbackEnabled bool

	ClusterMode               string
	ClusterHeartbeatSeconds   int
	ClusterMasterDeadSeconds  int
	ClusterPeerTimeoutSeconds int

	OsrmBaseURL             string
	RoutingMode             string
	RoutingProvider         string
	RoutingProviderPriority []string

	NotificationsEnabled bool
	DynamicIslandEnabled bool
	JitterEnabled        bool

	Favorites     []domain.Favorite
	RecentHistory []domain.HistoryEntry
}

func (s Settings) RuntimeConfig() RuntimeConfig {
	return RuntimeConfig{
		CompanionPort:             s.CompanionPort,
		PreferredDriver:           s.PreferredDriver,
		UsbDriver:                 s.UsbDriver,
		WifiDriver:                s.WifiDriver,
		FallbackEnabled:           s.FallbackEnabled,
		ClusterMode:               s.ClusterMode,
		ClusterHeartbeatSeconds:   s.ClusterHeartbeatSeconds,
		ClusterMasterDeadSeconds:  s.ClusterMasterDeadSeconds,
		ClusterPeerTimeoutSeconds: s.ClusterPeerTimeoutSeconds,
		OsrmBaseURL:               s.OsrmBaseURL,
		RoutingMode:               s.RoutingMode,
		RoutingProvider:           s.RoutingProvider,
		RoutingProviderPriority:   s.RoutingProviderPriority,
		NotificationsEnabled:      s.NotificationsEnabled,
		DynamicIslandEnabled:      s.DynamicIslandEnabled,
		JitterEnabled:             s.JitterEnabled,
		Favorites:                 s.Favorites,
		RecentHistory:             s.RecentHistory,
	}
}
