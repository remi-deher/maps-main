package cluster

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// ─── Cert/plist sync (opt-in) ───────────────────────────────────────────────

// plistFile is a single pairing-record file as exchanged between peers.
type plistFile struct {
	Name    string `json:"name"`
	Content string `json:"content"` // base64
}

// runCertSync drives both directions of the opt-in pairing-record sync: a
// fresh slave pulls the master's folder once, and a master pushes any file
// that changed since the last tick to every peer.
func (m *Manager) runCertSync(ctx context.Context) {
	m.mu.RLock()
	enabled, role, master, synced := m.syncCerts, m.role, m.currentMaster, m.initialSynced
	m.mu.RUnlock()
	if !enabled {
		return
	}

	if role == "slave" && master != "" && master != "me" && !synced {
		m.pullCertsFromMaster(ctx, master)
		return
	}
	if role == "master" {
		m.pushChangedCerts(ctx)
	}
}

func (m *Manager) pullCertsFromMaster(ctx context.Context, masterKey string) {
	host, portStr, err := net.SplitHostPort(masterKey)
	if err != nil {
		slog.Warn("cluster: skipping cert sync, invalid master key", "master", masterKey, "error", err)
		return
	}
	port, err := strconv.Atoi(portStr)
	url, ok := peerURL(host, port, "/api/cluster/plists")
	if err != nil || !ok {
		slog.Warn("cluster: skipping cert sync, invalid master key", "master", masterKey)
		return
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := m.client.Do(req)
	if err != nil {
		slog.Warn("cluster: initial cert sync failed", "master", masterKey, "error", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var files []plistFile
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		slog.Warn("cluster: decoding cert sync payload failed", "master", masterKey, "error", err)
		return
	}
	for _, f := range files {
		m.writeLocalPlist(f.Name, f.Content)
	}
	slog.Info("cluster: synced pairing records from master", "count", len(files), "master", masterKey)

	m.mu.Lock()
	m.initialSynced = true
	m.mu.Unlock()
}

func (m *Manager) pushChangedCerts(ctx context.Context) {
	dir := m.lockdownDir()
	if dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	m.mu.Lock()
	peers := make([]*Peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.mu.Unlock()
	if len(peers) == 0 {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name, ok := sanitizeFileName(entry.Name())
		if !ok {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		m.mu.RLock()
		last, seen := m.certMtimes[name]
		m.mu.RUnlock()
		if seen && !info.ModTime().After(last) {
			continue
		}

		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}

		m.mu.Lock()
		m.certMtimes[name] = info.ModTime()
		m.mu.Unlock()

		file := plistFile{Name: name, Content: base64.StdEncoding.EncodeToString(content)}
		for _, p := range peers {
			go m.pushPlistTo(ctx, p, file)
		}
	}
}

func (m *Manager) pushPlistTo(ctx context.Context, p *Peer, file plistFile) {
	url, ok := peerURL(p.Address, p.Port, "/api/cluster/sync-plist")
	if !ok {
		slog.Warn("cluster: skipping pairing record push, invalid peer address", "address", p.Address, "port", p.Port)
		return
	}
	body, _ := json.Marshal(file)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		slog.Warn("cluster: pushing pairing record failed", "name", file.Name, "peer", fmt.Sprintf("%s:%d", p.Address, p.Port), "error", err)
		return
	}
	_ = resp.Body.Close()
}

// writeLocalPlist decodes and writes a pairing-record file into the local
// Lockdown folder. Best-effort: a missing/unwritable folder (e.g. the
// process lacks the elevated rights this folder normally requires) is logged
// and skipped rather than failing the cluster.
func (m *Manager) writeLocalPlist(name, contentB64 string) {
	dir := m.lockdownDir()
	if dir == "" {
		slog.Warn("cluster: cannot sync pairing record, no local Lockdown folder", "name", name)
		return
	}
	content, err := base64.StdEncoding.DecodeString(contentB64)
	if err != nil {
		slog.Warn("cluster: pairing record has invalid base64 content", "name", name, "error", err)
		return
	}
	safeName, ok := sanitizeFileName(name)
	if !ok {
		slog.Warn("cluster: rejecting pairing record with unsafe name", "name", name)
		return
	}
	if err := os.WriteFile(filepath.Join(dir, safeName), content, 0o600); err != nil {
		slog.Warn("cluster: writing pairing record failed", "name", name, "error", err)
	}
}
