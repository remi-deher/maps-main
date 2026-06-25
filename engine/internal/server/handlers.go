package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
)

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

// ─── log filtering (GET /api/logs query params) ─────────────────────────────

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
