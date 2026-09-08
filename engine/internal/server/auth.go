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
// Independently of the mode, a request carrying a browser Origin we don't
// recognise is refused outright (see origin.go) — the loopback trust above must
// not be borrowable by any web page the user happens to visit.
//
// A paired-device token is "<deviceID>.<secret>"; it is accepted in either mode
// when an auth store is attached (WithAuth).
func (s *Server) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	// Origin first: a request from a hostile page is refused even when it
	// would otherwise authenticate (it arrives over loopback, and a browser
	// attaches the user's own credentials). See origin.go.
	if !checkOrigin(r) {
		denyOrigin(w)
		return false
	}

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

// bearerOrQueryToken pulls the credential from the request, preferring the
// places where it does not end up in a URL.
//
// A token in a query string leaks: it lands in server access logs, in proxy
// logs, in `ps` output for anything that shells out with the URL, and in the
// Referer of any subsequent navigation. So the order is:
//
//  1. Authorization: Bearer — used by every REST caller, and by the iOS
//     companion's WebSocket handshake (URLSession can set headers on it).
//  2. Sec-WebSocket-Protocol: bearer, <token> — the standard trick for
//     browsers, which cannot set arbitrary headers on a WebSocket handshake
//     but can name subprotocols.
//  3. ?token= — retained for compatibility with already-paired clients that
//     predate the two above. Deprecated; do not use it in new callers.
func bearerOrQueryToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	if tok := subprotocolToken(r); tok != "" {
		return tok
	}
	return r.URL.Query().Get("token")
}

// subprotocolToken reads a credential offered as a WebSocket subprotocol pair,
// i.e. `Sec-WebSocket-Protocol: bearer, <token>`. Anything that isn't that
// exact two-element shape is ignored — a real subprotocol negotiation must not
// be mistaken for a credential.
func subprotocolToken(r *http.Request) string {
	raw := r.Header.Get("Sec-WebSocket-Protocol")
	if raw == "" {
		return ""
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), "bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// isLoopback reports whether the request originates from the local machine.
// RemoteAddr is host:port; a parse failure is treated as non-loopback (fail
// closed). There is no proxy in front of the engine, so RemoteAddr is the real
// peer and can't be spoofed by a header.
func isLoopback(r *http.Request) bool {
	ip := net.ParseIP(clientIP(r))
	return ip != nil && ip.IsLoopback()
}

// clientIP is the peer address without its port. Like isLoopback it reads
// RemoteAddr and never a forwarding header: there is no proxy in front of the
// engine, so a header would be attacker-controlled and would let a brute-force
// hand itself a fresh throttle bucket per request.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
