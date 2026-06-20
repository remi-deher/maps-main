// Package api defines the wire contract shared by every client (desktop, iOS,
// browser): the REST shapes and the WebSocket message vocabulary. It is the
// single source of truth that the OpenAPI/AsyncAPI specs in /spec describe.
package api

import (
	"encoding/json"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// Envelope is the common wrapper for every WebSocket message: {type, data}.
type Envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// Inbound action types (client -> engine). Mirrors the legacy socket vocabulary.
const (
	ActionSetLocation    = "SET_LOCATION"
	ActionClearLocation  = "CLEAR_LOCATION"
	ActionPlayRoute      = "PLAY_ROUTE"
	ActionPlayOsrmRoute  = "PLAY_OSRM_ROUTE"
	ActionPlaySequence   = "PLAY_SEQUENCE"
	ActionPlayCustomGpx  = "PLAY_CUSTOM_GPX"
	ActionStopRoute      = "STOP_ROUTE"
	ActionPauseRoute     = "PAUSE_ROUTE"
	ActionResumeRoute    = "RESUME_ROUTE"
	ActionAddFavorite    = "ADD_FAVORITE"
	ActionRemoveFavorite = "REMOVE_FAVORITE"
	ActionRenameFavorite = "RENAME_FAVORITE"
	ActionAddHistory     = "ADD_HISTORY"
	ActionSaveSettings   = "SAVE_SETTINGS"
	ActionHeartbeat      = "HEARTBEAT"
	ActionRealLocation   = "REAL_LOCATION"
	ActionGetStatus      = "GET_STATUS"
	ActionDebugLog       = "DEBUG_LOG"
	ActionSequenceSync   = "SEQUENCE_SYNC"
	ActionPatrolUpdate   = "PATROL_UPDATE"
	ActionRelance        = "RELANCE"
)

// Outbound event types (engine -> client).
const (
	EventStatus                 = "STATUS"
	EventStatusUpdate           = "STATUS_UPDATE"
	EventAck                    = "ACK"
	EventPong                   = "PONG"
	EventLocation               = "LOCATION"
	EventTelemetry              = "TELEMETRY"
	EventSequencePreviewUpdated = "SEQUENCE_PREVIEW_UPDATED"
	EventRouteFinished          = "ROUTE_FINISHED"
)

// ─── Inbound payloads ────────────────────────────────────────────────────────

// SetLocationPayload is the data for SET_LOCATION.
type SetLocationPayload struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Name string  `json:"name,omitempty"`
}

// PlayRoutePayload is the data for PLAY_ROUTE / PLAY_OSRM_ROUTE.
type PlayRoutePayload struct {
	EndLat  float64 `json:"endLat"`
	EndLon  float64 `json:"endLon"`
	Speed   float64 `json:"speed,omitempty"`
	Profile string  `json:"profile,omitempty"` // driving | walking | cycling
}

// PlaySequencePayload is the data for PLAY_SEQUENCE.
type PlaySequencePayload struct {
	Legs    []domain.RouteLeg `json:"legs"`
	Looping bool              `json:"looping,omitempty"`
}

// PlayCustomGpxPayload is the data for PLAY_CUSTOM_GPX.
type PlayCustomGpxPayload struct {
	GpxContent string  `json:"gpxContent"`
	Speed      float64 `json:"speed,omitempty"`
}

// FavoritePayload covers ADD_FAVORITE / REMOVE_FAVORITE / RENAME_FAVORITE /
// ADD_HISTORY (NewName only used by rename).
type FavoritePayload struct {
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Name    string  `json:"name,omitempty"`
	NewName string  `json:"newName,omitempty"`
}

// HeartbeatPayload is the data for HEARTBEAT.
type HeartbeatPayload struct {
	IsMaintaining bool    `json:"isMaintaining,omitempty"`
	Latitude      float64 `json:"latitude,omitempty"`
	Longitude     float64 `json:"longitude,omitempty"`
	Timestamp     int64   `json:"timestamp,omitempty"`
}

// RealLocationPayload is the data for REAL_LOCATION (anti-drift shield).
type RealLocationPayload struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// DebugLogPayload is the data for DEBUG_LOG.
type DebugLogPayload struct {
	Message string `json:"message"`
}

// SequenceSyncPayload is the data for SEQUENCE_SYNC.
type SequenceSyncPayload struct {
	Points []domain.SequencePoint `json:"points"`
}

// PatrolUpdatePayload is the data for PATROL_UPDATE.
type PatrolUpdatePayload struct {
	Zone domain.PatrolZone `json:"zone"`
}

// SaveSettingsPayload is the data for SAVE_SETTINGS: a partial settings object.
// Kept open (map) so the engine can apply only the provided keys.
type SaveSettingsPayload map[string]any

// ─── Outbound payloads ───────────────────────────────────────────────────────

// AckPayload confirms a SET_LOCATION / CLEAR_LOCATION.
type AckPayload struct {
	Lat       float64 `json:"lat,omitempty"`
	Lon       float64 `json:"lon,omitempty"`
	Timestamp int64   `json:"timestamp"`
}

// PongPayload answers a HEARTBEAT.
type PongPayload struct {
	Timestamp int64 `json:"timestamp"`
}

// LocationPayload broadcasts the current spoofed position.
type LocationPayload struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Name string  `json:"name,omitempty"`
}

// TelemetryPayload carries periodic network metrics.
type TelemetryPayload struct {
	Latency    float64 `json:"latency"`
	PacketLoss float64 `json:"packetLoss"`
	Uptime     int64   `json:"uptime"`
	Throughput float64 `json:"throughput,omitempty"`
}

// RouteFinishedPayload signals route completion.
type RouteFinishedPayload struct {
	Timestamp int64          `json:"timestamp"`
	Location  *LocationStamp `json:"location,omitempty"`
}
