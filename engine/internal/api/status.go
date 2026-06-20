package api

import "github.com/remi-deher/maps-main/engine/internal/domain"

// EnvInfo describes the runtime environment of the engine.
type EnvInfo struct {
	OS       string `json:"os"`
	IsDocker bool   `json:"isDocker"`
	Mode     string `json:"mode"` // Headless | Desktop
	Version  string `json:"version"`
}

// ClusterPeer is a known node in the HA cluster.
type ClusterPeer struct {
	Address string `json:"address"`
	Port    int    `json:"port"`
	Online  bool   `json:"online,omitempty"`
	Role    string `json:"role,omitempty"`
	Name    string `json:"name,omitempty"`
}

// ClusterInfo is the cluster section of the status.
type ClusterInfo struct {
	Role  string        `json:"role"` // master | slave | standalone
	Mode  string        `json:"mode"` // off | manual | auto
	Peers []ClusterPeer `json:"peers"`
}

// LocationStamp is an injected/verified location with a timestamp.
type LocationStamp struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Name      string  `json:"name,omitempty"`
	Timestamp int64   `json:"timestamp,omitempty"`
}

// RealLocation is the device's actual reported position plus drift in meters.
type RealLocation struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Drift     float64 `json:"drift,omitempty"`
	Timestamp int64   `json:"timestamp,omitempty"`
}

// Status is the full state object broadcast on the STATUS event and returned by
// GET /api/status. It mirrors the legacy companion-server payload.
type Status struct {
	State          string                `json:"state"` // idle | ready | starting | running | moving
	TunnelActive   bool                  `json:"tunnelActive"`
	RSDAddress     string                `json:"rsdAddress"`
	RSDPort        int                   `json:"rsdPort"`
	ConnectionType domain.ConnectionType `json:"connectionType"`
	DeviceInfo     *domain.DeviceInfo    `json:"deviceInfo"`

	LastInjectedLocation *LocationStamp `json:"lastInjectedLocation"`
	LastVerifiedLocation *LocationStamp `json:"lastVerifiedLocation"`
	LastActiveLocation   *LocationStamp `json:"lastActiveLocation"`
	LastRealLocation     *RealLocation  `json:"lastRealLocation"`

	MaintainActive bool  `json:"maintainActive"`
	LastHeartbeat  int64 `json:"lastHeartbeat"`

	UsbDriver       domain.DriverID `json:"usbDriver"`
	WifiDriver      domain.DriverID `json:"wifiDriver"`
	FallbackEnabled bool            `json:"fallbackEnabled"`

	NotificationsEnabled bool `json:"notificationsEnabled"`
	DynamicIslandEnabled bool `json:"dynamicIslandEnabled"`

	Favorites              []domain.Favorite      `json:"favorites"`
	RecentHistory          []domain.HistoryEntry  `json:"recentHistory"`
	CurrentSequencePreview []domain.SequencePoint `json:"currentSequencePreview"`
	PatrolZone             *domain.PatrolZone     `json:"patrolZone"`
	Navigation             domain.Navigation      `json:"navigation"`

	EnvInfo EnvInfo      `json:"envInfo"`
	Cluster *ClusterInfo `json:"cluster,omitempty"`
}
