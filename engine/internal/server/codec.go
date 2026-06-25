package server

import (
	"encoding/json"
	"net/http"

	"github.com/remi-deher/maps-main/engine/internal/api"
)

// encode wraps data in an api.Envelope and marshals it for a WS broadcast/send.
func encode(eventType string, data any) []byte {
	d, _ := json.Marshal(data)
	b, _ := json.Marshal(api.Envelope{Type: eventType, Data: d})
	return b
}

// opResult is the generic {success, error} shape returned by REST endpoints
// that don't have a more specific response payload.
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
