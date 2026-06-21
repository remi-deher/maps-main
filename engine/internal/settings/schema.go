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
		CompanionPort:        8080,
		ConnectionMode:       "both",
		OperationMode:        domain.ModeHybrid,
		EveilMode:            true,
		EveilInterval:        5,
		PreferredDriver:      domain.DriverPmd3,
		UsbDriver:            domain.DriverPmd3,
		WifiDriver:           domain.DriverPmd3,
		FallbackEnabled:      true,
		ClusterMode:          "off",
		LogLevel:             "info",
		NotificationsEnabled: true,
		DynamicIslandEnabled: true,
		JitterEnabled:        true,
		Favorites:            []domain.Favorite{},
		RecentHistory:        []domain.HistoryEntry{},
	}
}
