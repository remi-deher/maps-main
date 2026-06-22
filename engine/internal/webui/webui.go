//go:build webui

// Package webui serves the compiled web frontend (the Tauri app's React build)
// directly from the engine, so a plain browser pointed at the engine gets the
// full UI — the "headless + web" product. Compiled only with -tags webui; the
// embedded/ payload (tauri-app/dist) is assembled in CI before the tagged
// build and gitignored, so ordinary builds (tests, engine-ci) need neither
// Node nor the dist output and use the no-op stub in webui_stub.go.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:embedded
var assets embed.FS

// Handler serves the embedded single-page app at /, falling back to index.html
// for client-side routes (any path that isn't a real bundled asset). Returns
// nil if the payload is missing, so the caller can skip mounting it.
func Handler() http.Handler {
	sub, err := fs.Sub(assets, "embedded")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		// Unknown path that isn't a bundled file → SPA client route: serve
		// index.html and let the frontend router handle it.
		if _, err := fs.Stat(sub, p); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
