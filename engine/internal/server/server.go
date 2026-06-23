// Package server exposes the Engine over HTTP: a small REST surface and a raw
// WebSocket channel carrying {type,data} envelopes (see internal/api).
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/driver"
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

// ─── REST ────────────────────────────────────────────────────────────────────

// healthResponse is intentionally separate from api.Status: a liveness/
// readiness probe (load balancer, systemd, Docker HEALTHCHECK, k8s) should
// get a fast, dependency-free "is the process up" answer, not the full
// simulation/driver/cluster snapshot that /api/status returns.
type healthResponse struct {
	Status string `json:"status"` // always "ok" if this handler runs at all
	Uptime int64  `json:"uptimeSeconds"`
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{
		Status: "ok",
		Uptime: int64(time.Since(s.startedAt).Seconds()),
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.eng.Status())
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	query := r.URL.Query()
	logs := filterLogs(s.eng.GetLogs(), logQuery{
		level:    query.Get("level"),
		source:   query.Get("source"),
		category: query.Get("category"),
		action:   query.Get("action"),
		q:        query.Get("q"),
		limit:    parseLogLimit(query.Get("limit")),
	})
	writeJSON(w, http.StatusOK, logs)
}

func (s *Server) handleSet(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	var p api.SetLocationPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, opErr(err))
		return
	}
	if err := p.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, opErr(err))
		return
	}
	if err := s.eng.SetLocation(r.Context(), p.Lat, p.Lon, p.Name); err != nil {
		writeJSON(w, http.StatusOK, opErr(err))
		return
	}
	writeJSON(w, http.StatusOK, opOK())
}

func (s *Server) handleClear(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	if err := s.eng.ClearLocation(r.Context()); err != nil {
		writeJSON(w, http.StatusOK, opErr(err))
		return
	}
	writeJSON(w, http.StatusOK, opOK())
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true }, // companion/desktop are trusted LAN clients
}

// maxWSMessageBytes bounds a single inbound WebSocket message (PLAY_CUSTOM_GPX
// carries the largest legitimate payload — a GPX file — so this is sized
// generously for that, not for the typical few-hundred-byte action). Without
// a limit a buggy or malicious client could send an arbitrarily large
// message and force an unbounded allocation in ReadMessage.
const maxWSMessageBytes = 16 * 1024 * 1024 // 16 MiB

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxWSMessageBytes)
	c := &client{conn: conn, send: make(chan []byte, 16), limiter: newRateLimiter(10, 20)}
	s.hub.register <- c

	// Greet the new client with the current status.
	c.send <- encode(api.EventStatus, s.eng.Status())

	go c.writePump()
	s.readPump(c)
}

// readPump dispatches inbound envelopes for one client until it disconnects.
func (s *Server) readPump(c *client) {
	defer func() {
		s.hub.unregister <- c
		_ = c.conn.Close()
	}()
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if c.limiter != nil && !c.limiter.allow() {
			slog.Warn("WS client rate limit exceeded, closing connection")
			c.send <- encode(api.EventLog, api.LogEntryPayload{
				Timestamp: time.Now().UnixMilli(),
				Level:     "error",
				Source:    "server",
				Category:  "websocket",
				Action:    "rate_limit",
				Message:   "Rate limit exceeded (10 msg/s). Connection closed.",
			})
			return
		}
		var env api.Envelope
		if json.Unmarshal(raw, &env) != nil {
			continue
		}
		s.dispatch(c, env)
	}
}

// dispatchUnmarshal decodes env.Data into a fresh T and, on success, runs fn
// with it; a decode failure is silently ignored (matching the prior
// per-action behavior) and an fn error is logged under label. It factors out
// the unmarshal-then-call-then-log-on-error shape shared by most dispatch
// cases below. If T implements Validate() error (see internal/api/validate.go),
// it's checked before fn runs — a validation failure is logged as a warning
// and fn is not called.
func dispatchUnmarshal[T any](env api.Envelope, label string, fn func(T) error) error {
	var p T
	if err := json.Unmarshal(env.Data, &p); err != nil {
		return err
	}
	if v, ok := any(p).(interface{ Validate() error }); ok {
		if err := v.Validate(); err != nil {
			slog.Warn(label+": rejecting invalid payload", "error", err)
			return err
		}
	}
	err := fn(p)
	if err != nil {
		slog.Error(label, "error", err)
	}
	return err
}

func (s *Server) dispatch(c *client, env api.Envelope) {
	ctx, cancel := context.WithTimeout(context.Background(), s.actionTimeout)
	defer cancel()

	var err error
	defer func() {
		if env.Type != api.ActionSwitchDriver {
			s.trackAction(env.Type, err)
		}
	}()

	switch env.Type {
	case api.ActionSetLocation:
		err = dispatchUnmarshal(env, "SET_LOCATION", func(p api.SetLocationPayload) error {
			return s.eng.SetLocation(ctx, p.Lat, p.Lon, p.Name)
		})
	case api.ActionClearLocation:
		err = s.eng.ClearLocation(ctx)
		if err != nil {
			slog.Error("CLEAR_LOCATION", "error", err)
		}
	case api.ActionGetStatus:
		c.send <- encode(api.EventStatus, s.eng.Status())
	case api.ActionRealLocation:
		err = dispatchUnmarshal(env, "REAL_LOCATION", func(p api.RealLocationPayload) error {
			s.eng.ReportRealLocation(ctx, p.Latitude, p.Longitude)
			return nil
		})
	case api.ActionHeartbeat:
		var p api.HeartbeatPayload
		_ = json.Unmarshal(env.Data, &p)
		c.send <- encode(api.EventPong, s.eng.Heartbeat(p))
	case api.ActionPlayRoute, api.ActionPlayOsrmRoute:
		err = dispatchUnmarshal(env, "PLAY_ROUTE", func(p api.PlayRoutePayload) error {
			return s.eng.PlayRoute(ctx, p.EndLat, p.EndLon, p.Speed, p.Profile)
		})
	case api.ActionPlaySequence:
		err = dispatchUnmarshal(env, "PLAY_SEQUENCE", func(p api.PlaySequencePayload) error {
			return s.eng.PlaySequence(ctx, p.Legs, p.Looping)
		})
	case api.ActionPlayCustomGpx:
		err = dispatchUnmarshal(env, "PLAY_CUSTOM_GPX", func(p api.PlayCustomGpxPayload) error {
			return s.eng.PlayCustomGpx(ctx, p.GpxContent, p.Speed)
		})
	case api.ActionPatrolUpdate:
		err = dispatchUnmarshal(env, "PATROL_UPDATE", func(p api.PatrolUpdatePayload) error {
			return s.eng.PatrolUpdate(ctx, p.Zone)
		})
	case api.ActionStopRoute:
		err = s.eng.StopRoute(ctx)
		if err != nil {
			slog.Error("STOP_ROUTE", "error", err)
		}
	case api.ActionPauseRoute:
		err = s.eng.PauseRoute(ctx)
		if err != nil {
			slog.Error("PAUSE_ROUTE", "error", err)
		}
	case api.ActionResumeRoute:
		err = s.eng.ResumeRoute(ctx)
		if err != nil {
			slog.Error("RESUME_ROUTE", "error", err)
		}
	case api.ActionAddFavorite:
		err = dispatchUnmarshal(env, "ADD_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.AddFavorite(ctx, p.Lat, p.Lon, p.Name)
		})
	case api.ActionRemoveFavorite:
		err = dispatchUnmarshal(env, "REMOVE_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.RemoveFavorite(ctx, p.Lat, p.Lon)
		})
	case api.ActionRenameFavorite:
		err = dispatchUnmarshal(env, "RENAME_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.RenameFavorite(ctx, p.Lat, p.Lon, p.NewName)
		})
	case api.ActionClearHistory:
		err = s.eng.ClearHistory(ctx)
		if err != nil {
			slog.Error("CLEAR_HISTORY", "error", err)
		}
	case api.ActionSwitchDriver:
		var p api.SwitchDriverPayload
		swErr := json.Unmarshal(env.Data, &p)
		if swErr == nil {
			go func(driverID, transport string) {
				swCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
				defer cancel()
				execErr := s.eng.SwitchDriver(swCtx, driverID, transport)
				if execErr != nil {
					slog.Error("SWITCH_DRIVER", "error", execErr)
				}
				s.trackAction(api.ActionSwitchDriver, execErr)
			}(p.DriverID, p.Transport)
		} else {
			s.trackAction(api.ActionSwitchDriver, swErr)
		}
	case api.ActionGetLogs:
		c.send <- encode(api.EventLogs, s.eng.GetLogs())
	case api.ActionDebugLog:
		err = dispatchUnmarshal(env, "DEBUG_LOG", func(p api.DebugLogPayload) error {
			level := p.Level
			if level == "" {
				level = "info"
			}
			source := p.Source
			if source == "" {
				source = "ios-client"
			}
			s.eng.LogEvent(level, source, p.Category, p.Action, p.Message, p.Fields)
			return nil
		})
	case api.ActionSaveSettings:
		err = dispatchUnmarshal(env, "SAVE_SETTINGS", func(p api.SaveSettingsPayload) error {
			return s.eng.SaveSettings(ctx, p)
		})
	case api.ActionRelance:
		err = s.eng.Relance(ctx)
		if err != nil {
			slog.Error("RELANCE", "error", err)
		}
	case api.ActionGetDeviceInfo:
		var info driver.DeviceDetails
		info, err = s.eng.GetDeviceInfo(ctx)
		if err != nil {
			slog.Error("GET_DEVICE_INFO", "error", err)
			c.send <- encode(api.EventDeviceInfo, api.DeviceInfoPayload{Error: err.Error()})
			break
		}
		c.send <- encode(api.EventDeviceInfo, api.DeviceInfoPayload{
			UDID:           info.UDID,
			Name:           info.Name,
			ProductType:    info.ProductType,
			ProductVersion: info.ProductVersion,
			SerialNumber:   info.SerialNumber,
			WifiAddress:    info.WifiAddress,
			TunnelAddress:  info.TunnelAddress,
		})
	default:
		slog.Warn("server: unrecognized WS action", "type", env.Type)
		err = fmt.Errorf("unrecognized WS action: %s", env.Type)
	}
}

type logQuery struct {
	level    string
	source   string
	category string
	action   string
	q        string
	limit    int
}

func parseLogLimit(raw string) int {
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0
	}
	if n > 1000 {
		return 1000
	}
	return n
}

func filterLogs(logs []api.LogEntryPayload, q logQuery) []api.LogEntryPayload {
	var out []api.LogEntryPayload
	for _, entry := range logs {
		if q.level != "" && !strings.EqualFold(entry.Level, q.level) {
			continue
		}
		if q.source != "" && !strings.EqualFold(entry.Source, q.source) {
			continue
		}
		if q.category != "" && !strings.EqualFold(entry.Category, q.category) {
			continue
		}
		if q.action != "" && !strings.EqualFold(entry.Action, q.action) {
			continue
		}
		if q.q != "" && !logEntryContains(entry, q.q) {
			continue
		}
		out = append(out, entry)
	}
	if q.limit > 0 && len(out) > q.limit {
		out = out[len(out)-q.limit:]
	}
	return out
}

func logEntryContains(entry api.LogEntryPayload, query string) bool {
	needle := strings.ToLower(query)
	for _, value := range []string{entry.Level, entry.Source, entry.Category, entry.Action, entry.Message} {
		if strings.Contains(strings.ToLower(value), needle) {
			return true
		}
	}
	for key, value := range entry.Fields {
		if strings.Contains(strings.ToLower(key), needle) || strings.Contains(strings.ToLower(value), needle) {
			return true
		}
	}
	return false
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func encode(eventType string, data any) []byte {
	d, _ := json.Marshal(data)
	b, _ := json.Marshal(api.Envelope{Type: eventType, Data: d})
	return b
}

type opResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func opOK() opResult         { return opResult{Success: true} }
func opErr(e error) opResult { return opResult{Success: false, Error: e.Error()} }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	apiKey := os.Getenv("GPSMOCK_API_KEY")
	if apiKey == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == apiKey {
			return true
		}
	}

	token := r.URL.Query().Get("token")
	if token == apiKey {
		return true
	}

	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte("401 Unauthorized\n"))
	return false
}

func (s *Server) incrementActionMetric(action, status string) {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	if s.wsActions[action] == nil {
		s.wsActions[action] = make(map[string]int64)
	}
	s.wsActions[action][status]++
}

func (s *Server) trackAction(action string, err error) {
	status := "success"
	if err != nil {
		status = statusError(err)
	}
	s.incrementActionMetric(action, status)
}

func statusError(err error) string {
	return "error"
}
