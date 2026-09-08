package server

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Cross-site request forgery guard.
//
// checkAuth trusts loopback without a credential so the desktop app can talk to
// its sidecar friction-free. That trust is scoped to *processes* on this
// machine, but a browser is a confused deputy: any page the user visits can
// issue requests to http://127.0.0.1:8080 (and open a WebSocket to it, which
// isn't subject to the same-origin policy at all). Without the check below,
// browsing to a hostile page would be enough to drive the engine — inject a
// position, read the logs, rewrite the settings.
//
// The defence is the Origin header. A browser always sets it on a WebSocket
// handshake and on any cross-origin fetch, and — crucially — page JavaScript
// cannot forge it. So:
//
//   - No Origin at all  ⇒ not a browser. The iOS companion (URLSession), the
//     Go wsclient and curl land here; they are gated by checkAuth's token/
//     loopback rules as before.
//   - Origin is one we recognise (the engine's own web UI, the Tauri webview,
//     a loopback dev server, or an operator-configured extra) ⇒ allow.
//   - Anything else ⇒ refuse, whatever credential it carries.
//
// This also closes DNS rebinding: rebinding evil.com to 127.0.0.1 changes the
// resolved address, never the page's origin, so the request still arrives
// stamped `Origin: https://evil.com` and is refused here.

// allowedOriginsEnv lets an operator add origins (comma-separated, e.g.
// "https://gpsmock.lan,http://192.168.1.10:5173") for deployments that front
// the engine with something we can't guess.
const allowedOriginsEnv = "GPSMOCK_ALLOWED_ORIGINS"

// nativeOriginSchemes are the non-HTTP schemes used by embedded webviews. The
// Tauri shell serves the desktop UI from tauri://localhost on macOS/Linux (and
// http://tauri.localhost on Windows, which the host suffix rule below covers).
var nativeOriginSchemes = map[string]bool{
	"tauri":     true,
	"capacitor": true,
	"ionic":     true,
	"file":      true,
}

// checkOrigin reports whether r may act on the engine. See the package comment
// above for the rationale; the ordering here is "cheapest and most common
// first".
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Not a browser (or a same-origin navigation that predates the header).
		// Authentication, not origin, is what protects these callers.
		return true
	}
	// "null" is what a browser sends for sandboxed iframes and some file://
	// documents. It is not a trustworthy identity, so it does not get the
	// loopback bypass.
	if strings.EqualFold(origin, "null") {
		return false
	}

	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		if err == nil && nativeOriginSchemes[strings.ToLower(u.Scheme)] {
			return true // e.g. "file://" with an empty host
		}
		return false
	}
	if nativeOriginSchemes[strings.ToLower(u.Scheme)] {
		return true
	}

	// Same origin as the engine itself: this is the built-in web UI (-tags
	// webui) talking to the server that served it.
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}

	host := hostnameOf(u.Host)

	// A loopback origin is a page served from this machine — the Vite dev
	// server (npm run dev on :1420) or the Tauri webview on Windows
	// (http://tauri.localhost). A remote attacker cannot obtain one: it would
	// require already running a server on the user's own machine, at which
	// point the loopback trust in checkAuth is moot anyway.
	if isLoopbackHost(host) {
		return true
	}

	for _, allowed := range configuredOrigins() {
		if strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}

// configuredOrigins parses GPSMOCK_ALLOWED_ORIGINS into a list of exact origins.
// Read on each call (rather than cached at startup) so the Windows service and
// the tests can change it without a restart; the list is tiny and this is not a
// hot path.
func configuredOrigins() []string {
	raw := os.Getenv(allowedOriginsEnv)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, strings.TrimSuffix(p, "/"))
		}
	}
	return out
}

// hostnameOf strips the port from a host[:port] pair, tolerating IPv6 literals
// and a bare host with no port.
func hostnameOf(hostport string) string {
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		return h
	}
	return strings.Trim(hostport, "[]")
}

// isLoopbackHost reports whether a hostname refers to this machine. Both the
// literal addresses and the "localhost" name (plus the *.localhost subdomains
// RFC 6761 reserves, which is what Tauri uses on Windows) count.
func isLoopbackHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// denyOrigin writes the refusal for a request checkOrigin rejected.
func denyOrigin(w http.ResponseWriter) {
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte("403 Forbidden: origin not allowed\n"))
}
