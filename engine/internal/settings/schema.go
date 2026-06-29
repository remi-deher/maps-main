// Package settings defines the persisted configuration schema and its defaults.
// Phase 1 ships the types only; loading/saving lands with the engine.
package settings

import "github.com/remi-deher/maps-main/engine/internal/domain"

// Settings is the full persisted configuration (legacy settings.json equivalent).
type Settings struct {
	// Network / companion
	WifiIp        string `json:"wifiIp,omitempty"`
	WifiPort      int    `json:"wifiPort,omitempty"`
	CompanionPort int    `json:"companionPort"`

	// Connection / operation
	ConnectionMode string               `json:"connectionMode"` // usb | wifi | both
	OperationMode  domain.OperationMode `json:"operationMode"`
	EveilMode      bool                 `json:"isEveilMode"`
	EveilInterval  int                  `json:"eveilInterval"` // seconds

	// Drivers (the runtime "menu")
	PreferredDriver domain.DriverID `json:"preferredDriver"`
	UsbDriver       domain.DriverID `json:"usbDriver"`
	WifiDriver      domain.DriverID `json:"wifiDriver"`
	FallbackEnabled bool            `json:"fallbackEnabled"`

	// Manual / network-only tunnel
	ServerIp            string `json:"serverIp,omitempty"`
	PreferredIp         string `json:"preferredIp,omitempty"`
	ManualTunnelMode    bool   `json:"manualTunnelMode"`
	ManualTunnelAddress string `json:"manualTunnelAddress,omitempty"` // "address:port"
	NetworkOnlyMode     bool   `json:"networkOnlyMode"`

	// Cluster
	ClusterMode      string   `json:"clusterMode"` // off | manual | auto
	ClusterNodes     []string `json:"clusterNodes,omitempty"`
	ServerName       string   `json:"serverName,omitempty"`
	ClusterSyncCerts bool     `json:"clusterSyncCerts"` // sync the Lockdown pairing-record folder across the cluster (opt-in)

	// Cluster heartbeat/failover tuning (seconds) — were env-only, now editable
	// from the web interface. Zero means "use the built-in default".
	ClusterHeartbeatSeconds   int `json:"clusterHeartbeatSeconds,omitempty"`
	ClusterMasterDeadSeconds  int `json:"clusterMasterDeadSeconds,omitempty"`
	ClusterPeerTimeoutSeconds int `json:"clusterPeerTimeoutSeconds,omitempty"`

	// Routing
	OsrmBaseURL             string   `json:"osrmBaseUrl,omitempty"`             // OSRM routing server; empty = built-in default
	RoutingMode             string   `json:"routingMode,omitempty"`             // auto | manual
	RoutingProvider         string   `json:"routingProvider,omitempty"`         // provider forced when RoutingMode=manual
	RoutingProviderPriority []string `json:"routingProviderPriority,omitempty"` // ordered provider ids used by auto mode

	// Misc / iOS prefs
	LogLevel             string `json:"logLevel"`
	NotificationsEnabled bool   `json:"notificationsEnabled"`
	DynamicIslandEnabled bool   `json:"dynamicIslandEnabled"`
	JitterEnabled        bool   `json:"jitterEnabled"`

	// Data
	Favorites          []domain.Favorite     `json:"favorites"`
	RecentHistory      []domain.HistoryEntry `json:"recentHistory"`
	LastActiveLocation *domain.Coords        `json:"lastActiveLocation,omitempty"`
}

// Default returns the baseline configuration used on first run.
func Default() Settings {
	return Settings{
		CompanionPort:  8080,
		ConnectionMode: "both",
		OperationMode:  domain.ModeHybrid,
		EveilMode:      true,
		EveilInterval:  5,
		// go-ios is the default: a single static binary with no runtime deps,
		// bundled across all distributions (Docker compiles it, the Windows
		// portable zip and the Tauri app ship it). pymobiledevice remains
		// selectable but needs Python, so it's no longer the out-of-the-box
		// default — see the v0.2.0 autonomous-bundle work.
		PreferredDriver:           domain.DriverGoIos,
		UsbDriver:                 domain.DriverGoIos,
		WifiDriver:                domain.DriverGoIos,
		FallbackEnabled:           true,
		ClusterMode:               "off",
		ClusterHeartbeatSeconds:   10,
		ClusterMasterDeadSeconds:  30,
		ClusterPeerTimeoutSeconds: 3,
		RoutingMode:               "auto",
		RoutingProvider:           "osrm",
		RoutingProviderPriority:   []string{"google", "mapbox", "osrm"},
		LogLevel:                  "info",
		NotificationsEnabled:      true,
		DynamicIslandEnabled:      true,
		JitterEnabled:             true,
		Favorites:                 []domain.Favorite{},
		RecentHistory:             []domain.HistoryEntry{},
	}
}
