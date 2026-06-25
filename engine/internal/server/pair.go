package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/auth"
)

// handlePairCode returns the current rotating pairing code. It is loopback-only:
// the code is a secret that should only ever be rendered by the trusted desktop
// UI (which talks to the sidecar over localhost), never served to a remote peer
// — otherwise pairing would be self-authorizing.
func (s *Server) handlePairCode(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("403 Forbidden\n"))
		return
	}
	code, err := s.auth.CurrentCode(time.Now())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, opErr(err))
		return
	}
	// secondsRemaining lets the UI render the countdown without re-deriving the
	// step itself.
	secondsRemaining := 30 - (time.Now().Unix() % 30)
	writeJSON(w, http.StatusOK, struct {
		Code             string `json:"code"`
		SecondsRemaining int64  `json:"secondsRemaining"`
	}{Code: code, SecondsRemaining: secondsRemaining})
}

// handlePair redeems a pairing code for a durable device token. This is the one
// endpoint a not-yet-trusted remote client may call, so it is intentionally
// outside checkAuth — the code itself is the credential. On success the caller
// receives "<deviceID>.<secret>" once and stores it for all later connections.
func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Code  string `json:"code"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, opErr(err))
		return
	}
	if !s.auth.VerifyCode(p.Code, time.Now()) {
		writeJSON(w, http.StatusUnauthorized, opErr(errors.New("invalid or expired pairing code")))
		return
	}
	token, dev, err := s.auth.Pair(p.Label)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, opErr(err))
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Token  string      `json:"token"`
		Device auth.Device `json:"device"`
	}{Token: token, Device: dev})
}

// handleListDevices lists paired devices for the management UI. Loopback-only:
// the device inventory is shown in the desktop app's settings, not exposed to
// remote clients.
func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("403 Forbidden\n"))
		return
	}
	devices, err := s.auth.ListDevices()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, opErr(err))
		return
	}
	if devices == nil {
		devices = []auth.Device{}
	}
	writeJSON(w, http.StatusOK, devices)
}

// handleRevokeDevice removes one paired device. Loopback-only: revocation is a
// management action performed from the desktop app.
func (s *Server) handleRevokeDevice(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("403 Forbidden\n"))
		return
	}
	id := r.PathValue("id")
	if err := s.auth.Revoke(id); err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, auth.ErrInvalidToken) {
			code = http.StatusNotFound
		}
		writeJSON(w, code, opErr(err))
		return
	}
	writeJSON(w, http.StatusOK, opOK())
}
