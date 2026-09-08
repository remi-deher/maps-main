package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// doOrigin is do() with an Origin header, which is what turns a request into a
// browser-shaped one as far as checkOrigin is concerned.
func doOrigin(h http.Handler, method, target, remoteAddr, origin, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.RemoteAddr = remoteAddr
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// The headline case: a page the user happens to visit must not be able to
// borrow the engine's loopback trust, even though its requests genuinely
// originate from 127.0.0.1.
func TestHostileOriginIsRefusedOverLoopback(t *testing.T) {
	h, _ := newAuthHandler(t)

	rec := doOrigin(h, "GET", "/api/status", loopbackAddr, "https://evil.example", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("GET /api/status from hostile origin = %d, want 403", rec.Code)
	}

	// Same for the state-changing endpoints — this is the one that matters.
	rec = doOrigin(h, "POST", "/api/location/set", loopbackAddr,
		"https://evil.example", `{"lat":48.85,"lon":2.35}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /api/location/set from hostile origin = %d, want 403", rec.Code)
	}
}

// Pairing is credential-free, so it carries the origin check itself rather than
// inheriting it from checkAuth.
func TestPairEndpointRefusesHostileOrigin(t *testing.T) {
	h, _ := newAuthHandler(t)

	rec := doOrigin(h, "POST", "/api/pair", remoteAddr, "https://evil.example", `{"code":"000000"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /api/pair from hostile origin = %d, want 403", rec.Code)
	}
}

// Legitimate callers must keep working: native clients send no Origin at all,
// and the two browser-ish clients (the built-in web UI, the Tauri webview) send
// one we recognise.
func TestLegitimateOriginsAreAllowed(t *testing.T) {
	h, _ := newAuthHandler(t)

	for _, tc := range []struct {
		name   string
		origin string
	}{
		{"no origin (iOS companion, curl, wsclient)", ""},
		{"tauri webview on macOS/Linux", "tauri://localhost"},
		{"tauri webview on Windows", "http://tauri.localhost"},
		{"vite dev server", "http://localhost:1420"},
		{"loopback by IP", "http://127.0.0.1:8080"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if rec := doOrigin(h, "GET", "/api/status", loopbackAddr, tc.origin, ""); rec.Code != http.StatusOK {
				t.Errorf("GET /api/status with Origin %q = %d, want 200", tc.origin, rec.Code)
			}
		})
	}
}

// The web UI served by the engine itself is same-origin, whatever host the user
// reached it on — so it must be allowed without any configuration.
func TestSameOriginAsEngineIsAllowed(t *testing.T) {
	h, _ := newAuthHandler(t)

	req := httptest.NewRequest("GET", "http://192.168.1.10:8080/api/status", nil)
	req.RemoteAddr = loopbackAddr
	req.Host = "192.168.1.10:8080"
	req.Header.Set("Origin", "http://192.168.1.10:8080")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("same-origin request = %d, want 200", rec.Code)
	}
}

func TestConfiguredOriginIsAllowed(t *testing.T) {
	t.Setenv(allowedOriginsEnv, "https://gpsmock.lan, https://other.example")
	h, _ := newAuthHandler(t)

	if rec := doOrigin(h, "GET", "/api/status", loopbackAddr, "https://gpsmock.lan", ""); rec.Code != http.StatusOK {
		t.Errorf("configured origin = %d, want 200", rec.Code)
	}
	if rec := doOrigin(h, "GET", "/api/status", loopbackAddr, "https://not-configured.example", ""); rec.Code != http.StatusForbidden {
		t.Errorf("unconfigured origin = %d, want 403", rec.Code)
	}
}

// Unit-level coverage of the predicate for the shapes an HTTP-level test can't
// easily produce.
func TestCheckOriginEdgeCases(t *testing.T) {
	for _, tc := range []struct {
		origin string
		want   bool
	}{
		{"null", false},                 // sandboxed iframe: not an identity we can trust
		{"http://localhost", true},      // no port
		{"http://[::1]:8080", true},     // IPv6 loopback literal
		{"http://LOCALHOST:3000", true}, // case-insensitive
		{"file://", true},               // packaged webview
		{"not a url at all", false},
		{"http://evil.com.localhost.attacker.net", false}, // suffix must be the real one
		{"http://127.0.0.1.evil.com", false},              // not an IP, not *.localhost
	} {
		req := httptest.NewRequest("GET", "/api/status", nil)
		req.Header.Set("Origin", tc.origin)
		if got := checkOrigin(req); got != tc.want {
			t.Errorf("checkOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
		}
	}
}
