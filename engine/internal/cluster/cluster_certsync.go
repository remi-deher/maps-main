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
	"strconv"
	"time"
)

// ─── Cert/plist sync (opt-in) ───────────────────────────────────────────────

// plistFile is a single pairing-record file as exchanged between peers.
type plistFile struct {
	Name    string `json:"name"`
	Content string `json:"content"` // base64
	ModTime int64  `json:"modTime"` // Unix milli
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
		m.writeLocalPlist(f.Name, f.Content, f.ModTime)
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

		path, ok := lockdownFilePath(dir, name)
		if !ok {
			continue
		}
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		m.mu.Lock()
		m.certMtimes[name] = info.ModTime()
		m.mu.Unlock()

		file := plistFile{
			Name:    name,
			Content: base64.StdEncoding.EncodeToString(content),
			ModTime: info.ModTime().UnixMilli(),
		}
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
func (m *Manager) writeLocalPlist(name, contentB64 string, modTimeMilli int64) {
	dir := m.lockdownDir()
	if dir == "" {
		slog.Warn("cluster: cannot sync pairing record, no local Lockdown folder", "name", name)
		return
	}

	path, ok := lockdownFilePath(dir, name)
	if !ok {
		slog.Warn("cluster: rejecting pairing record with unsafe name", "name", name)
		return
	}

	// If the file already exists locally, check its modification time.
	if info, err := os.Stat(path); err == nil && modTimeMilli > 0 {
		// If the local file is newer or equal, skip writing.
		if !time.UnixMilli(modTimeMilli).After(info.ModTime()) {
			slog.Debug("cluster: skipping pairing record sync, local version is newer or equal", "name", name)
			return
		}
	}

	content, err := base64.StdEncoding.DecodeString(contentB64)
	if err != nil {
		slog.Warn("cluster: pairing record has invalid base64 content", "name", name, "error", err)
		return
	}

	if err := os.WriteFile(path, content, 0o600); err != nil {
		slog.Warn("cluster: writing pairing record failed", "name", name, "error", err)
		return
	}

	// Apply the sender's ModTime to the local file to keep it synced.
	if modTimeMilli > 0 {
		t := time.UnixMilli(modTimeMilli)
		if err := os.Chtimes(path, time.Now(), t); err != nil {
			slog.Warn("cluster: setting modification time failed", "name", name, "error", err)
		}

		// Also update internal cache so we don't immediately push this back.
		m.mu.Lock()
		m.certMtimes[name] = t
		m.mu.Unlock()
	}
}
