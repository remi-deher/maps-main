package cluster

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

// ─── HTTP peer protocol ─────────────────────────────────────────────────────

// RegisterRoutes wires the cluster's peer-to-peer protocol onto mux: other
// engines in the cluster call these directly (not through the iOS/desktop
// client API).
func (m *Manager) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/cluster/status", m.handleStatus)
	mux.HandleFunc("GET /api/cluster/ping", m.handlePing)
	mux.HandleFunc("POST /api/cluster/takeover", m.handleTakeover)
	mux.HandleFunc("GET /api/cluster/plists", m.handlePlists)
	mux.HandleFunc("POST /api/cluster/sync-plist", m.handleSyncPlist)
}

func (m *Manager) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, m.Status())
}

func (m *Manager) handlePing(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	resp := pingResponse{Role: m.role, Mode: m.mode, ServerName: m.serverName, Epoch: m.epoch}
	m.mu.RUnlock()
	if m.tunnelActive != nil {
		resp.TunnelActive = m.tunnelActive()
	}
	writeJSON(w, resp)
}

func (m *Manager) handleTakeover(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NewMaster string `json:"newMaster"`
		Epoch     int64  `json:"epoch"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	m.mu.Lock()
	if body.Epoch <= m.epoch {
		// Stale or duplicate claim — e.g. a node that was master before a
		// partition, reasserting itself after a peer already won a more
		// recent election. Ignore it rather than demoting ourselves under
		// an outdated master.
		m.mu.Unlock()
		writeResult(w, false)
		return
	}
	m.epoch = body.Epoch
	m.role = "slave"
	m.currentMaster = body.NewMaster
	m.lastMasterSeen = time.Now()
	m.initialSynced = false
	m.mu.Unlock()

	writeResult(w, true)
}

// handlePlists serves a snapshot of the local Lockdown folder for a slave's
// initial pull. Only meaningful when cert sync is enabled; returns an empty
// list otherwise rather than erroring.
func (m *Manager) handlePlists(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	enabled := m.syncCerts
	m.mu.RUnlock()

	var files []plistFile
	if enabled {
		if dir := m.lockdownDir(); dir != "" {
			entries, err := os.ReadDir(dir)
			if err == nil {
				for _, entry := range entries {
					if entry.IsDir() {
						continue
					}
					path, ok := lockdownFilePath(dir, entry.Name())
					if !ok {
						continue
					}
					content, err := os.ReadFile(path)
					if err != nil {
						continue
					}
					info, err := entry.Info()
					if err != nil {
						continue
					}
					files = append(files, plistFile{
						Name:    entry.Name(),
						Content: base64.StdEncoding.EncodeToString(content),
						ModTime: info.ModTime().UnixMilli(),
					})
				}
			}
		}
	}
	writeJSON(w, files)
}

// handleSyncPlist receives one pairing-record file pushed by the master.
func (m *Manager) handleSyncPlist(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	enabled := m.syncCerts
	m.mu.RUnlock()
	if !enabled {
		writeResult(w, false)
		return
	}

	var f plistFile
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		writeResult(w, false)
		return
	}
	m.writeLocalPlist(f.Name, f.Content, f.ModTime)
	writeResult(w, true)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// writeResult is shorthand for the {"success": bool} responses several
// handlers above return.
func writeResult(w http.ResponseWriter, success bool) {
	writeJSON(w, map[string]bool{"success": success})
}
