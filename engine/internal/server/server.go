// Package server exposes the Engine over HTTP: a small REST surface and a raw
// WebSocket channel carrying {type,data} envelopes (see internal/api).
package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/engine"
)

const actionTimeout = 60 * time.Second

// Server ties the Engine to an HTTP/WebSocket front end.
type Server struct {
	eng  *engine.Engine
	hub  *hub
	http *http.Server
}

// New builds a Server listening on addr (e.g. ":8080").
func New(eng *engine.Engine, addr string) *Server {
	s := &Server{eng: eng, hub: newHub()}

	// Engine events -> broadcast to every connected client.
	eng.OnEvent(func(eventType string, data any) {
		s.hub.broadcast(encode(eventType, data))
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("POST /api/location/set", s.handleSet)
	mux.HandleFunc("POST /api/location/clear", s.handleClear)
	mux.HandleFunc("/ws", s.handleWS)

	s.http = &http.Server{Addr: addr, Handler: mux}
	return s
}

// Start launches the broadcast hub (non-blocking). Called by ListenAndServe and
// by tests that drive the Handler directly.
func (s *Server) Start() { go s.hub.run() }

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

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.eng.Status())
}

func (s *Server) handleSet(w http.ResponseWriter, r *http.Request) {
	var p api.SetLocationPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
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

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &client{conn: conn, send: make(chan []byte, 16)}
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
		var env api.Envelope
		if json.Unmarshal(raw, &env) != nil {
			continue
		}
		s.dispatch(c, env)
	}
}

func (s *Server) dispatch(c *client, env api.Envelope) {
	ctx, cancel := context.WithTimeout(context.Background(), actionTimeout)
	defer cancel()

	switch env.Type {
	case api.ActionSetLocation:
		var p api.SetLocationPayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.SetLocation(ctx, p.Lat, p.Lon, p.Name); err != nil {
				log.Printf("SET_LOCATION: %v", err)
			}
		}
	case api.ActionClearLocation:
		if err := s.eng.ClearLocation(ctx); err != nil {
			log.Printf("CLEAR_LOCATION: %v", err)
		}
	case api.ActionGetStatus:
		c.send <- encode(api.EventStatus, s.eng.Status())
	case api.ActionRealLocation:
		var p api.RealLocationPayload
		if json.Unmarshal(env.Data, &p) == nil {
			s.eng.ReportRealLocation(ctx, p.Latitude, p.Longitude)
		}
	case api.ActionHeartbeat:
		var p api.HeartbeatPayload
		_ = json.Unmarshal(env.Data, &p)
		c.send <- encode(api.EventPong, s.eng.Heartbeat(p))
	case api.ActionPlayRoute, api.ActionPlayOsrmRoute:
		var p api.PlayRoutePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.PlayRoute(ctx, p.EndLat, p.EndLon, p.Speed, p.Profile); err != nil {
				log.Printf("PLAY_ROUTE: %v", err)
			}
		}
	case api.ActionPlaySequence:
		var p api.PlaySequencePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.PlaySequence(ctx, p.Legs, p.Looping); err != nil {
				log.Printf("PLAY_SEQUENCE: %v", err)
			}
		}
	case api.ActionPlayCustomGpx:
		var p api.PlayCustomGpxPayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.PlayCustomGpx(ctx, p.GpxContent, p.Speed); err != nil {
				log.Printf("PLAY_CUSTOM_GPX: %v", err)
			}
		}
	case api.ActionPatrolUpdate:
		var p api.PatrolUpdatePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.PatrolUpdate(ctx, p.Zone); err != nil {
				log.Printf("PATROL_UPDATE: %v", err)
			}
		}
	case api.ActionStopRoute:
		if err := s.eng.StopRoute(ctx); err != nil {
			log.Printf("STOP_ROUTE: %v", err)
		}
	case api.ActionPauseRoute:
		if err := s.eng.PauseRoute(ctx); err != nil {
			log.Printf("PAUSE_ROUTE: %v", err)
		}
	case api.ActionResumeRoute:
		if err := s.eng.ResumeRoute(ctx); err != nil {
			log.Printf("RESUME_ROUTE: %v", err)
		}
	case api.ActionAddFavorite:
		var p api.FavoritePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.AddFavorite(ctx, p.Lat, p.Lon, p.Name); err != nil {
				log.Printf("ADD_FAVORITE: %v", err)
			}
		}
	case api.ActionRemoveFavorite:
		var p api.FavoritePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.RemoveFavorite(ctx, p.Lat, p.Lon); err != nil {
				log.Printf("REMOVE_FAVORITE: %v", err)
			}
		}
	case api.ActionRenameFavorite:
		var p api.FavoritePayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.RenameFavorite(ctx, p.Lat, p.Lon, p.NewName); err != nil {
				log.Printf("RENAME_FAVORITE: %v", err)
			}
		}
	case api.ActionClearHistory:
		if err := s.eng.ClearHistory(ctx); err != nil {
			log.Printf("CLEAR_HISTORY: %v", err)
		}
	case api.ActionGetLogs:
		c.send <- encode(api.EventLogs, s.eng.GetLogs())
	case api.ActionDebugLog:
		var p api.DebugLogPayload
		if json.Unmarshal(env.Data, &p) == nil {
			s.eng.Log("info", "ios-client", p.Message)
		}
	case api.ActionSaveSettings:
		var p api.SaveSettingsPayload
		if json.Unmarshal(env.Data, &p) == nil {
			if err := s.eng.SaveSettings(ctx, p); err != nil {
				log.Printf("SAVE_SETTINGS: %v", err)
			}
		}
	case api.ActionRelance:
		if err := s.eng.Relance(ctx); err != nil {
			log.Printf("RELANCE: %v", err)
		}
	case api.ActionGetDeviceInfo:
		info, err := s.eng.GetDeviceInfo(ctx)
		if err != nil {
			log.Printf("GET_DEVICE_INFO: %v", err)
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
		// Other actions land in later phases.
	}
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
