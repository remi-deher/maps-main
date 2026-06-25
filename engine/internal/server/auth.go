package server

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// checkAuth gates a request. There are two modes, decided by whether the static
// GPSMOCK_API_KEY is set:
//
//   - API-key mode (GPSMOCK_API_KEY set): full lock-down. Every request — even
//     loopback — must present the key (Bearer/?token=) or a valid paired-device
//     token. This is the headless/scripted deployment that wants nothing open
//     by default.
//   - Default mode (no API key): loopback is allowed (the desktop app talks to
//     its sidecar over localhost, friction-free), and any *remote* request must
//     present a valid paired-device token obtained via QR pairing. Without one,
//     a remote request is rejected — reachable off-box is not the same as open.
//
// A paired-device token is "<deviceID>.<secret>"; it is accepted in either mode
// when an auth store is attached (WithAuth).
func (s *Server) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	token := bearerOrQueryToken(r)

	if s.auth != nil && token != "" && s.auth.VerifyToken(token) {
		return true
	}

	if apiKey := os.Getenv("GPSMOCK_API_KEY"); apiKey != "" {
		// Explicit key ⇒ it is the only loopback-bypassing credential.
		if token == apiKey {
			return true
		}
	} else if isLoopback(r) {
		return true
	}

	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte("401 Unauthorized\n"))
	return false
}

// bearerOrQueryToken pulls the credential from the Authorization: Bearer header,
// falling back to the ?token= query param (needed for the WebSocket handshake,
// where browsers can't set custom headers).
func bearerOrQueryToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

// isLoopback reports whether the request originates from the local machine.
// RemoteAddr is host:port; a parse failure is treated as non-loopback (fail
// closed). There is no proxy in front of the engine, so RemoteAddr is the real
// peer and can't be spoofed by a header.
func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
