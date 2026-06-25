package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
