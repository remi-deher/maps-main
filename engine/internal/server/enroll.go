package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/remi-deher/maps-main/engine/internal/enroller"
)

// handleEnroll is HTTP plumbing only: decode the request, hand it to the
// enroller package, translate its outcome into a response. The actual
// pairing-record write lives in internal/enroller so it has no dependency
// on this package's HTTP types and can be tested/reused independently.
func (s *Server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	var p struct {
		UDID         string `json:"udid"`
		DeviceRecord string `json:"deviceRecord"`           // base64
		SelfIdentity string `json:"selfIdentity,omitempty"` // base64, ignored or written if needed
	}
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, opErr(err))
		return
	}

	req := enroller.Request{UDID: p.UDID, DeviceRecord: p.DeviceRecord}
	if err := req.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, opErr(err))
		return
	}

	if _, err := enroller.Enroll(req); err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, enroller.ErrInvalidInput) {
			code = http.StatusBadRequest
		}
		writeJSON(w, code, opErr(err))
		return
	}

	writeJSON(w, http.StatusOK, opOK())
}
