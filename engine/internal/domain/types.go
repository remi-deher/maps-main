// Package domain holds the engine's shared business types. It is agnostic of
// any transport, driver or UI — every other package depends on it, never the
// reverse.
package domain

// DriverID identifies a tunnel driver implementation.
type DriverID string

const (
	DriverPmd3  DriverID = "pymobiledevice"
	DriverGoIos DriverID = "go-ios"
)

// ConnectionType describes how the engine reached the device.
type ConnectionType string

const (
	ConnUSB     ConnectionType = "USB"
	ConnWiFi    ConnectionType = "WiFi"
	ConnManual  ConnectionType = "MANUAL"
	ConnUnknown ConnectionType = "UNKNOWN"
)

// OperationMode controls who is allowed to drive the position.
type OperationMode string

const (
	ModeHybrid       OperationMode = "hybrid"        // dashboard + companion
	ModeClientServer OperationMode = "client-server" // companion only
	ModeAutonomous   OperationMode = "autonomous"    // dashboard only
)

// LegType is the movement mode of a sequence leg.
type LegType string

const (
	LegStart  LegType = "start"
	LegDrive  LegType = "drive"
	LegWalk   LegType = "walk"
	LegFlight LegType = "flight"
	LegWait   LegType = "wait"
)

// Coords is a geographic point as used across the API.
type Coords struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Name string  `json:"name,omitempty"`
}

// LatLon is a bare coordinate pair (no name).
type LatLon struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Favorite is a bookmarked location.
type Favorite struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Name      string  `json:"name,omitempty"`
	Timestamp int64   `json:"timestamp,omitempty"`
}

// HistoryEntry is a recently visited location (same shape as a Favorite).
type HistoryEntry = Favorite

// PatrolBounds is the rectangle of a patrol zone.
type PatrolBounds struct {
	NE LatLon `json:"ne"`
	SW LatLon `json:"sw"`
}

// PatrolZone defines an area in which the device wanders randomly.
type PatrolZone struct {
	Type   string        `json:"type"` // "circle" | "rectangle"
	Center *LatLon       `json:"center,omitempty"`
	Radius float64       `json:"radius,omitempty"` // meters (circle)
	Bounds *PatrolBounds `json:"bounds,omitempty"` // rectangle
	Active bool          `json:"active"`
}

// RouteLeg is one segment of a multimodal journey sent to the engine.
type RouteLeg struct {
	Type      LegType `json:"type"`
	Start     LatLon  `json:"start"`
	End       LatLon  `json:"end"`
	StartTime int64   `json:"startTime,omitempty"`
	EndTime   int64   `json:"endTime,omitempty"`
	Speed     float64 `json:"speed,omitempty"` // km/h
}

// SequencePoint is a single playback point (time is an epoch ms used for delays).
type SequencePoint struct {
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	TimeMs int64   `json:"time,omitempty"`
}

// DeviceInfo describes the connected iPhone.
type DeviceInfo struct {
	UDID   string   `json:"udid"`
	Name   string   `json:"name"`
	Driver DriverID `json:"driver"`
}

// NavigationProgress is the live progress of an active route.
type NavigationProgress struct {
	Index int     `json:"index"`
	Total int     `json:"total"`
	Lat   float64 `json:"lat"`
	Lon   float64 `json:"lon"`
	Speed float64 `json:"speed"` // km/h
}

// NavigationStatus is the control state of an active route.
type NavigationStatus struct {
	State       string  `json:"state"` // running | paused | stopped
	Index       int     `json:"index"`
	Total       int     `json:"total"`
	Destination *Coords `json:"destination,omitempty"`
}

// Navigation groups the route progress and status.
type Navigation struct {
	Progress *NavigationProgress `json:"progress"`
	Status   *NavigationStatus   `json:"status"`
}
