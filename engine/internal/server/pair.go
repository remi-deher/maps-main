package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
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

// ─── WebSocket pairing management (loopback-only) ─────────────────────────────
//
// The desktop window talks to its sidecar over the same WebSocket as everything
// else; routing pairing through it (instead of a REST fetch) avoids the
// cross-origin CORS wall the Tauri webview hits on http://localhost calls. Each
// handler replies only to the requesting client and refuses any client that
// isn't loopback — the rotating code is a secret a LAN/remote client must never
// read, and device management is a local-operator action.

// guardPairWS returns true if the client may use the pairing-management actions.
// On refusal it sends the matching error event to that client only.
func (s *Server) guardPairWS(c *client, errEvent string) bool {
	if s.auth == nil {
		c.send <- encode(errEvent, map[string]string{"error": "remote access not configured"})
		return false
	}
	if !c.loopback {
		c.send <- encode(errEvent, map[string]string{"error": "forbidden"})
		return false
	}
	return true
}

func (s *Server) dispatchGetPairCode(c *client) error {
	if !s.guardPairWS(c, api.EventPairCode) {
		return nil
	}
	code, err := s.auth.CurrentCode(time.Now())
	if err != nil {
		slog.Error("GET_PAIR_CODE", "error", err)
		c.send <- encode(api.EventPairCode, api.PairCodePayload{Error: err.Error()})
		return err
	}
	c.send <- encode(api.EventPairCode, api.PairCodePayload{
		Code:             code,
		SecondsRemaining: 30 - (time.Now().Unix() % 30),
	})
	return nil
}

func (s *Server) dispatchListPairedDevices(c *client) error {
	if !s.guardPairWS(c, api.EventPairedDevices) {
		return nil
	}
	c.send <- encode(api.EventPairedDevices, s.pairedDevicesPayload())
	return nil
}

func (s *Server) dispatchRevokePairedDevice(c *client, env api.Envelope) error {
	if !s.guardPairWS(c, api.EventPairedDevices) {
		return nil
	}
	var p api.RevokePairedDevicePayload
	if err := json.Unmarshal(env.Data, &p); err != nil {
		c.send <- encode(api.EventPairedDevices, api.PairedDevicesPayload{Error: err.Error()})
		return err
	}
	if err := s.auth.Revoke(p.ID); err != nil && !errors.Is(err, auth.ErrInvalidToken) {
		slog.Error("REVOKE_PAIRED_DEVICE", "error", err)
		c.send <- encode(api.EventPairedDevices, api.PairedDevicesPayload{Error: err.Error()})
		return err
	}
	// Reply with the refreshed list so the UI updates from one event type.
	c.send <- encode(api.EventPairedDevices, s.pairedDevicesPayload())
	return nil
}

// pairedDevicesPayload reads the paired-device list and maps it to the wire
// payload (errors surface in the payload's Error field).
func (s *Server) pairedDevicesPayload() api.PairedDevicesPayload {
	devices, err := s.auth.ListDevices()
	if err != nil {
		return api.PairedDevicesPayload{Error: err.Error()}
	}
	out := api.PairedDevicesPayload{Devices: make([]api.PairedDevicePayload, 0, len(devices))}
	for _, d := range devices {
		out.Devices = append(out.Devices, api.PairedDevicePayload{
			ID: d.ID, Label: d.Label, CreatedAt: d.CreatedAt, LastSeen: d.LastSeen,
		})
	}
	return out
}
