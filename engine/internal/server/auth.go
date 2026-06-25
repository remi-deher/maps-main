package server

import (
	"net/http"
	"os"
	"strings"
)

// checkAuth enforces GPSMOCK_API_KEY (if set) via a Bearer header or ?token=
// query param. With no key configured, every request is allowed — the
// engine is assumed to run on a trusted LAN in that case.
func (s *Server) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	apiKey := os.Getenv("GPSMOCK_API_KEY")
	if apiKey == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == apiKey {
			return true
		}
	}

	token := r.URL.Query().Get("token")
	if token == apiKey {
		return true
	}

	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte("401 Unauthorized\n"))
	return false
}
