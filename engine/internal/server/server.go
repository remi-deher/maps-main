// Package server exposes the Engine over HTTP: a small REST surface and a raw
// WebSocket channel carrying {type,data} envelopes (see internal/api).
//
// The package is split by responsibility across files:
//   - server.go: Server lifecycle (New/Start/ListenAndServe/Shutdown), route
//     registration, telemetry loop.
//   - handlers.go: REST handlers (health/status/logs/location) + log filtering.
//   - websocket.go: WS upgrade and the per-connection read loop.
//   - dispatch.go: WS envelope -> Engine call routing.
//   - enroll.go: thin HTTP adapter over internal/enroller.
//   - auth.go: API-key check shared by every handler.
//   - metrics.go: Prometheus exposition + per-action WS counters.
//   - codec.go: small JSON/response helpers shared across the above.
//   - hub.go: WebSocket client/broadcast plumbing.
package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/webui"
)

const (
	defaultActionTimeout     = 60 * time.Second
	defaultTelemetryInterval = 5 * time.Second
)

// Server ties the Engine to an HTTP/WebSocket front end.
type Server struct {
	eng       *engine.Engine
	hub       *hub
	http      *http.Server
	startedAt time.Time

	actionTimeout     time.Duration
	telemetryInterval time.Duration

	metricsMu sync.Mutex
	wsActions map[string]map[string]int64 // action -> status -> count
}

// Option configures optional Server behavior. Pass to New; everything has a
// sane default so existing callers (New(eng, addr)) don't need to change.
type Option func(*Server)

// WithActionTimeout overrides how long a single WebSocket action (dispatch)
// may run before its context is cancelled. Default: 60s.
func WithActionTimeout(d time.Duration) Option {
	return func(s *Server) { s.actionTimeout = d }
}

// WithTelemetryInterval overrides how often the TELEMETRY event is sampled
// and broadcast. Default: 5s.
func WithTelemetryInterval(d time.Duration) Option {
	return func(s *Server) { s.telemetryInterval = d }
}

// New builds a Server listening on addr (e.g. ":8080").
func New(eng *engine.Engine, addr string, opts ...Option) *Server {
	s := &Server{
		eng:               eng,
		hub:               newHub(),
		startedAt:         time.Now(),
		actionTimeout:     defaultActionTimeout,
		telemetryInterval: defaultTelemetryInterval,
		wsActions:         make(map[string]map[string]int64),
	}
	for _, opt := range opts {
		opt(s)
	}

	// Engine events -> broadcast to every connected client.
	eng.OnEvent(func(eventType string, data any) {
		s.hub.broadcast(encode(eventType, data))
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/logs", s.handleLogs)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("POST /api/location/set", s.handleSet)
	mux.HandleFunc("POST /api/location/clear", s.handleClear)
	mux.HandleFunc("POST /api/device/enroll", s.handleEnroll)
	mux.HandleFunc("/ws", s.handleWS)

	// Cluster peer-to-peer protocol (ping/takeover/status between engines),
	// distinct from the client-facing API above. Registered even if cluster
	// mode starts "off" so it can be turned on at runtime via SaveSettings.
	if mgr := eng.ClusterManager(); mgr != nil {
		mgr.RegisterRoutes(mux)
	}

	// Built-in web UI at / (only in -tags webui builds; nil otherwise). The
	// API/WS patterns above are more specific, so they take precedence over
	// this catch-all in the Go 1.22+ ServeMux.
	if h := webui.Handler(); h != nil {
		mux.Handle("/", h)
	}

	s.http = &http.Server{Addr: addr, Handler: mux}
	return s
}

// Start launches the broadcast hub (non-blocking). Called by ListenAndServe and
// by tests that drive the Handler directly.
func (s *Server) Start() {
	go s.hub.run()
	go s.runTelemetry()
}

// runTelemetry mirrors legacy's companion-server.js _telemetryInterval: every
// s.telemetryInterval it broadcasts a TELEMETRY event so the desktop app's
// network-status widget (tauri-app's MapContainer/Sidebar) has live data.
// Unlike the legacy server (and this engine's first cut), every field here is
// a real measurement, not a simulated one:
//   - Uptime: wall-clock time since the server started.
//   - Throughput: bytes actually broadcast to WS clients in the last
//     interval, in KB/s. 0 when no client is connected.
//   - PacketLoss: clients dropped for being too slow to keep up with the
//     broadcast queue, as a percentage of clients present in the interval.
//   - Latency: mean cluster peer ping RTT (a real network round-trip), or 0
//     when cluster mode is off/standalone — there's no other network call
//     this engine makes that a "latency" figure could honestly describe.
//
// Broadcasting unconditionally is harmless when no client is connected — the
// hub's fan-out loop over an empty client map is a no-op.
func (s *Server) runTelemetry() {
	if s.startedAt.IsZero() {
		s.startedAt = time.Now()
	}
	ticker := time.NewTicker(s.telemetryInterval)
	defer ticker.Stop()
	for range ticker.C {
		bytesSent, dropped := s.hub.snapshotAndReset()
		throughputKBs := float64(bytesSent) / 1024 / s.telemetryInterval.Seconds()

		var packetLoss float64
		if present := uint64(s.hub.clientCount()) + dropped; present > 0 {
			packetLoss = float64(dropped) / float64(present) * 100
		}

		var latency float64
		if mgr := s.eng.ClusterManager(); mgr != nil {
			latency = mgr.AverageLatencyMs()
		}

		s.hub.broadcast(encode(api.EventTelemetry, api.TelemetryPayload{
			Latency:    latency,
			PacketLoss: packetLoss,
			Uptime:     int64(time.Since(s.startedAt).Seconds()),
			Throughput: throughputKBs,
		}))
	}
}

// Handler exposes the HTTP handler (REST + WebSocket) for testing.
func (s *Server) Handler() http.Handler { return s.http.Handler }

// ListenAndServe runs the hub and HTTP server (blocking).
func (s *Server) ListenAndServe() error {
	s.Start()
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}
