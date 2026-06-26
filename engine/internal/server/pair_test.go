package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/auth"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// newAuthHandler builds a server wired with a real auth store (temp DB) and
// returns its HTTP handler plus the store, so tests can drive requests with a
// chosen RemoteAddr (loopback vs remote).
func newAuthHandler(t *testing.T) (http.Handler, *auth.Store) {
	t.Helper()
	store, err := auth.OpenStore(t.TempDir() + "/auth.db")
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	srv := New(engine.New(&fakeDriver{}, settings.Default()), ":0", WithAuth(store))
	srv.Start()
	return srv.Handler(), store
}

func do(h http.Handler, method, target, remoteAddr, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const (
	loopbackAddr = "127.0.0.1:5555"
	remoteAddr   = "192.168.1.42:5555"
)

func TestPairCodeIsLoopbackOnly(t *testing.T) {
	h, _ := newAuthHandler(t)

	if rec := do(h, "GET", "/api/pair/code", loopbackAddr, ""); rec.Code != http.StatusOK {
		t.Errorf("loopback /api/pair/code = %d, want 200", rec.Code)
	}
	if rec := do(h, "GET", "/api/pair/code", remoteAddr, ""); rec.Code != http.StatusForbidden {
		t.Errorf("remote /api/pair/code = %d, want 403", rec.Code)
	}
}

func TestRemotePairingFlow(t *testing.T) {
	h, store := newAuthHandler(t)

	// A remote client with no credential is rejected.
	if rec := do(h, "GET", "/api/status", remoteAddr, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("remote /api/status without token = %d, want 401", rec.Code)
	}

	// The desktop reads the current code over loopback.
	codeRec := do(h, "GET", "/api/pair/code", loopbackAddr, "")
	var codeResp struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(codeRec.Body.Bytes(), &codeResp); err != nil {
		t.Fatalf("decode code: %v", err)
	}

	// The remote client redeems it for a durable token.
	pairRec := do(h, "POST", "/api/pair", remoteAddr, `{"code":"`+codeResp.Code+`","label":"Browser"}`)
	if pairRec.Code != http.StatusOK {
		t.Fatalf("pair = %d, want 200 (body: %s)", pairRec.Code, pairRec.Body.String())
	}
	var pairResp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(pairRec.Body.Bytes(), &pairResp); err != nil {
		t.Fatalf("decode pair: %v", err)
	}

	// With the token, the remote client is now authorized.
	if rec := do(h, "GET", "/api/status?token="+pairResp.Token, remoteAddr, ""); rec.Code != http.StatusOK {
		t.Errorf("remote /api/status with token = %d, want 200", rec.Code)
	}

	// A wrong code is refused.
	if rec := do(h, "POST", "/api/pair", remoteAddr, `{"code":"000000","label":"x"}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("pair with bad code = %d, want 401", rec.Code)
	}

	// The device shows up in the loopback-only inventory, and revoking it
	// invalidates the token.
	devices, _ := store.ListDevices()
	if len(devices) != 1 {
		t.Fatalf("ListDevices len = %d, want 1", len(devices))
	}
	if rec := do(h, "DELETE", "/api/pair/devices/"+devices[0].ID, loopbackAddr, ""); rec.Code != http.StatusOK {
		t.Errorf("revoke = %d, want 200", rec.Code)
	}
	if rec := do(h, "GET", "/api/status?token="+pairResp.Token, remoteAddr, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked token still works: status = %d, want 401", rec.Code)
	}
}

// TestPairWSLoopbackOnly verifies the WebSocket pairing-management actions
// (used by the desktop window, which can't fetch the REST endpoints from the
// Tauri webview because of CORS) answer a loopback client but refuse a remote
// one — the rotating code must never reach a LAN/remote client.
func TestPairWSLoopbackOnly(t *testing.T) {
	store, err := auth.OpenStore(t.TempDir() + "/auth.db")
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	srv := New(engine.New(&fakeDriver{}, settings.Default()), ":0", WithAuth(store))

	readEvent := func(c *client) api.Envelope {
		select {
		case raw := <-c.send:
			var env api.Envelope
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			return env
		case <-time.After(time.Second):
			t.Fatal("no reply on client send channel")
			return api.Envelope{}
		}
	}

	// Remote client: GET_PAIR_CODE is refused with a PAIR_CODE error, no code.
	remote := &client{send: make(chan []byte, 4), loopback: false}
	_ = srv.dispatchGetPairCode(remote)
	env := readEvent(remote)
	if env.Type != api.EventPairCode {
		t.Fatalf("remote reply type = %q, want %q", env.Type, api.EventPairCode)
	}
	var remotePayload api.PairCodePayload
	_ = json.Unmarshal(env.Data, &remotePayload)
	if remotePayload.Code != "" || remotePayload.Error == "" {
		t.Errorf("remote got code=%q error=%q, want empty code + an error", remotePayload.Code, remotePayload.Error)
	}

	// Loopback client: gets a real 6-digit code.
	local := &client{send: make(chan []byte, 4), loopback: true}
	_ = srv.dispatchGetPairCode(local)
	env = readEvent(local)
	var localPayload api.PairCodePayload
	_ = json.Unmarshal(env.Data, &localPayload)
	if len(localPayload.Code) != 6 || localPayload.Error != "" {
		t.Errorf("loopback got code=%q error=%q, want a 6-digit code", localPayload.Code, localPayload.Error)
	}
}

func TestPairWSListAndRevoke(t *testing.T) {
	store, err := auth.OpenStore(t.TempDir() + "/auth.db")
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	srv := New(engine.New(&fakeDriver{}, settings.Default()), ":0", WithAuth(store))

	token, dev, err := store.Pair("phone")
	if err != nil {
		t.Fatalf("Pair: %v", err)
	}

	readDevices := func(c *client) api.PairedDevicesPayload {
		raw := <-c.send
		var env api.Envelope
		_ = json.Unmarshal(raw, &env)
		if env.Type != api.EventPairedDevices {
			t.Fatalf("type = %q, want %q", env.Type, api.EventPairedDevices)
		}
		var p api.PairedDevicesPayload
		_ = json.Unmarshal(env.Data, &p)
		return p
	}

	local := &client{send: make(chan []byte, 4), loopback: true}
	_ = srv.dispatchListPairedDevices(local)
	if list := readDevices(local); len(list.Devices) != 1 || list.Devices[0].ID != dev.ID {
		t.Fatalf("list = %+v, want the one paired device", list.Devices)
	}

	// Revoke it via WS, then the refreshed list is empty and the token dies.
	revoke, _ := json.Marshal(api.RevokePairedDevicePayload{ID: dev.ID})
	_ = srv.dispatchRevokePairedDevice(local, api.Envelope{Type: api.ActionRevokePairedDevice, Data: revoke})
	if list := readDevices(local); len(list.Devices) != 0 {
		t.Errorf("after revoke, list = %+v, want empty", list.Devices)
	}
	if store.VerifyToken(token) {
		t.Error("revoked token still verifies")
	}
}
