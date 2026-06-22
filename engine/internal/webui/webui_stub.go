//go:build !webui

package webui

import "net/http"

// Handler returns nil in builds without the web UI bundled (-tags webui): the
// engine still serves its REST/WebSocket API, just no browser UI at /. See
// webui.go for the embedded variant.
func Handler() http.Handler { return nil }
