// Package cluster implements optional master/slave high-availability between
// several engine instances on the same LAN, porting legacy/server's
// cluster-manager.js. Unlike the legacy version (manual peer list only), peers
// can also be auto-discovered via the same Bonjour/mDNS service
// (_gpsmock._tcp) the engine already advertises for the iOS companion app —
// no IP:port to type when ClusterMode is "auto".
package cluster

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grandcat/zeroconf"

	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// ServiceType is the Bonjour/mDNS service the engine advertises itself under
// (see cmd/headless's advertiseMdns) and the one this package browses for
// when discovering cluster peers automatically.
const ServiceType = "_gpsmock._tcp"

const (
	heartbeatInterval  = 10 * time.Second
	masterDeadAfter    = 30 * time.Second
	peerRequestTimeout = 3 * time.Second
)

// Peer is a known node in the HA cluster, manually configured or discovered
// via mDNS.
type Peer struct {
	Address    string `json:"address"`
	Port       int    `json:"port"`
	Online     bool   `json:"online"`
	Role       string `json:"role,omitempty"`
	Name       string `json:"name,omitempty"`
	Discovered bool   `json:"discovered"` // found via mDNS auto-discovery rather than manual config

	lastSeen time.Time
}

func (p *Peer) key() string { return fmt.Sprintf("%s:%d", p.Address, p.Port) }

// Info is a snapshot of the cluster state, mirrored into api.Status.
type Info struct {
	Role  string `json:"role"` // master | slave | standalone
	Mode  string `json:"mode"` // off | manual | auto
	Peers []Peer `json:"peers"`
}

// TunnelActiveFunc lets the cluster manager report this node's tunnel state
// to peers without importing the engine package (avoids an import cycle).
type TunnelActiveFunc func() bool

// Manager owns cluster membership, heartbeating and master election. It is
// safe for concurrent use.
type Manager struct {
	mu sync.RWMutex

	mode       string // off | manual | auto
	role       string // master | slave | standalone
	serverName string
	selfPort   int

	peers          map[string]*Peer
	currentMaster  string
	lastMasterSeen time.Time

	tunnelActive TunnelActiveFunc
	client       *http.Client
	selfAddrs    map[string]bool // local non-loopback IPs, to ignore self in mDNS browsing

	// Cert/plist sync (opt-in): replicates the Lockdown pairing-record folder
	// across the cluster — mainly useful so a slave can take over USB/WiFi
	// injection for a device already paired on the master without re-pairing.
	// Off by default: most setups don't need every node to share device
	// pairing state, and writing into a system folder is worth gating.
	syncCerts     bool
	certDir       string // override for tests; empty means platform.LockdownDir()
	certMtimes    map[string]time.Time
	initialSynced bool

	cancel context.CancelFunc
}

// New builds a Manager from persisted settings. selfPort is the engine's own
// listen port (used to recognize/skip itself during mDNS discovery and to
// answer ping requests). syncCerts opts into replicating the Lockdown
// pairing-record folder across the cluster (see Manager.syncCerts).
func New(mode string, nodes []string, serverName string, selfPort int, tunnelActive TunnelActiveFunc, syncCerts bool) *Manager {
	if serverName == "" {
		if h, err := os.Hostname(); err == nil {
			serverName = h
		}
	}

	role := "standalone"
	if mode == "manual" || mode == "auto" {
		role = "slave"
	}

	m := &Manager{
		mode:         mode,
		role:         role,
		serverName:   serverName,
		selfPort:     selfPort,
		peers:        map[string]*Peer{},
		tunnelActive: tunnelActive,
		client:       &http.Client{Timeout: peerRequestTimeout},
		selfAddrs:    localAddrs(),
		syncCerts:    syncCerts,
		certMtimes:   map[string]time.Time{},
	}

	for _, n := range nodes {
		if p := parsePeerAddr(n); p != nil {
			m.peers[p.key()] = p
		}
	}
	return m
}

// lockdownDir returns the folder to sync pairing records from/to (overridable
// for tests via certDir).
func (m *Manager) lockdownDir() string {
	if m.certDir != "" {
		return m.certDir
	}
	return platform.LockdownDir()
}

func parsePeerAddr(addr string) *Peer {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		log.Printf("cluster: ignoring invalid peer address %q: %v", addr, err)
		return nil
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Printf("cluster: ignoring invalid peer port %q: %v", addr, err)
		return nil
	}
	return &Peer{Address: host, Port: port}
}

func localAddrs() map[string]bool {
	out := map[string]bool{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	for _, a := range addrs {
		if ipNet, ok := a.(*net.IPNet); ok {
			out[ipNet.IP.String()] = true
		}
	}
	return out
}

// Start begins heartbeating peers and, in "auto" mode, browsing mDNS for
// other engines on the LAN. It returns immediately; cancel via Stop or by
// cancelling ctx.
func (m *Manager) Start(ctx context.Context) {
	cctx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	m.cancel = cancel
	mode := m.mode
	m.mu.Unlock()

	if mode == "off" {
		return
	}

	go m.heartbeatLoop(cctx)
	if mode == "auto" {
		go m.browseMdns(cctx)
	}
}

// Stop tears down the heartbeat/discovery goroutines.
func (m *Manager) Stop() {
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// UpdateConfig applies a runtime settings change (cluster mode/peer list/cert
// sync), restarting heartbeat/discovery as needed.
func (m *Manager) UpdateConfig(ctx context.Context, mode string, nodes []string, syncCerts bool) {
	m.Stop()

	m.mu.Lock()
	m.mode = mode
	m.syncCerts = syncCerts
	m.initialSynced = false
	if mode == "off" {
		m.role = "standalone"
		m.currentMaster = ""
	} else if m.role == "" || m.role == "standalone" {
		m.role = "slave"
	}
	m.peers = map[string]*Peer{}
	for _, n := range nodes {
		if p := parsePeerAddr(n); p != nil {
			m.peers[p.key()] = p
		}
	}
	m.mu.Unlock()

	m.Start(ctx)
}

func (m *Manager) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.checkPeers(ctx)
			m.checkMasterHealth()
			m.runCertSync(ctx)
		}
	}
}

type pingResponse struct {
	Role         string `json:"role"`
	Mode         string `json:"mode"`
	ServerName   string `json:"serverName"`
	TunnelActive bool   `json:"tunnelActive"`
}

func (m *Manager) checkPeers(ctx context.Context) {
	m.mu.RLock()
	peers := make([]*Peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.mu.RUnlock()

	masterFound := ""
	for _, p := range peers {
		url := fmt.Sprintf("http://%s:%d/api/cluster/ping", p.Address, p.Port)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		resp, err := m.client.Do(req)
		if err != nil {
			m.mu.Lock()
			p.Online = false
			m.mu.Unlock()
			continue
		}
		var body pingResponse
		_ = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()

		m.mu.Lock()
		p.Online = true
		p.Role = body.Role
		if body.ServerName != "" {
			p.Name = body.ServerName
		}
		p.lastSeen = time.Now()
		if body.Role == "master" {
			masterFound = p.key()
			m.currentMaster = p.key()
			m.lastMasterSeen = time.Now()
		}
		m.mu.Unlock()
	}

	m.mu.Lock()
	if masterFound == "" && m.currentMaster != "" && m.currentMaster != "me" {
		m.currentMaster = ""
	}
	m.mu.Unlock()
}

func (m *Manager) checkMasterHealth() {
	m.mu.RLock()
	mode, role, master, lastSeen := m.mode, m.role, m.currentMaster, m.lastMasterSeen
	m.mu.RUnlock()

	if mode == "auto" && role == "slave" && master != "" && time.Since(lastSeen) > masterDeadAfter {
		log.Printf("cluster: master %s unreachable for >%s, taking over", master, masterDeadAfter)
		m.Takeover(context.Background())
	}
}

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
	url := fmt.Sprintf("http://%s/api/cluster/plists", masterKey)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := m.client.Do(req)
	if err != nil {
		log.Printf("cluster: initial cert sync from %s failed: %v", masterKey, err)
		return
	}
	defer resp.Body.Close()

	var files []plistFile
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		log.Printf("cluster: decoding cert sync payload from %s failed: %v", masterKey, err)
		return
	}
	for _, f := range files {
		m.writeLocalPlist(f.Name, f.Content)
	}
	log.Printf("cluster: synced %d pairing record(s) from master %s", len(files), masterKey)

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
		info, err := entry.Info()
		if err != nil {
			continue
		}

		m.mu.RLock()
		last, seen := m.certMtimes[entry.Name()]
		m.mu.RUnlock()
		if seen && !info.ModTime().After(last) {
			continue
		}

		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}

		m.mu.Lock()
		m.certMtimes[entry.Name()] = info.ModTime()
		m.mu.Unlock()

		file := plistFile{Name: entry.Name(), Content: base64.StdEncoding.EncodeToString(content)}
		for _, p := range peers {
			go m.pushPlistTo(ctx, p, file)
		}
	}
}

func (m *Manager) pushPlistTo(ctx context.Context, p *Peer, file plistFile) {
	url := fmt.Sprintf("http://%s:%d/api/cluster/sync-plist", p.Address, p.Port)
	body, _ := json.Marshal(file)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		log.Printf("cluster: pushing pairing record %q to %s:%d failed: %v", file.Name, p.Address, p.Port, err)
		return
	}
	resp.Body.Close()
}

// writeLocalPlist decodes and writes a pairing-record file into the local
// Lockdown folder. Best-effort: a missing/unwritable folder (e.g. the
// process lacks the elevated rights this folder normally requires) is logged
// and skipped rather than failing the cluster.
func (m *Manager) writeLocalPlist(name, contentB64 string) {
	dir := m.lockdownDir()
	if dir == "" {
		log.Printf("cluster: cannot sync pairing record %q, no local Lockdown folder", name)
		return
	}
	content, err := base64.StdEncoding.DecodeString(contentB64)
	if err != nil {
		log.Printf("cluster: pairing record %q has invalid base64 content: %v", name, err)
		return
	}
	if err := os.WriteFile(filepath.Join(dir, filepath.Base(name)), content, 0o600); err != nil {
		log.Printf("cluster: writing pairing record %q failed: %v", name, err)
	}
}

// Takeover promotes this node to master and notifies known peers.
func (m *Manager) Takeover(ctx context.Context) {
	m.mu.Lock()
	m.role = "master"
	m.currentMaster = "me"
	m.lastMasterSeen = time.Now()
	peers := make([]*Peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.mu.Unlock()

	for _, p := range peers {
		go func(p *Peer) {
			url := fmt.Sprintf("http://%s:%d/api/cluster/takeover", p.Address, p.Port)
			body, _ := json.Marshal(map[string]string{"newMaster": "me"})
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := m.client.Do(req)
			if err == nil {
				resp.Body.Close()
			}
		}(p)
	}
}

// Release steps this node down from master to slave (e.g. on graceful exit).
func (m *Manager) Release() {
	m.mu.Lock()
	if m.role == "master" {
		m.role = "slave"
	}
	m.mu.Unlock()
}

// SyncCertsEnabled reports whether pairing-record sync is currently enabled.
func (m *Manager) SyncCertsEnabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.syncCerts
}

// Status returns a snapshot of the cluster state.
func (m *Manager) Status() Info {
	m.mu.RLock()
	defer m.mu.RUnlock()
	peers := make([]Peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, *p)
	}
	return Info{Role: m.role, Mode: m.mode, Peers: peers}
}

// ─── mDNS auto-discovery ────────────────────────────────────────────────────

// browseMdns watches _gpsmock._tcp on the LAN and adds newly-seen engines as
// discovered peers, skipping this node's own advertisement.
func (m *Manager) browseMdns(ctx context.Context) {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Printf("cluster: mdns resolver unavailable, auto-discovery disabled: %v", err)
		return
	}

	entries := make(chan *zeroconf.ServiceEntry, 8)
	go func() {
		for entry := range entries {
			m.handleDiscovered(entry)
		}
	}()

	if err := resolver.Browse(ctx, ServiceType, "local.", entries); err != nil {
		log.Printf("cluster: mdns browse failed: %v", err)
		return
	}
	<-ctx.Done()
}

func (m *Manager) handleDiscovered(entry *zeroconf.ServiceEntry) {
	if entry.Port == m.selfPort && m.isSelfHost(entry) {
		return // our own advertisement, looping back through mDNS
	}

	var addr string
	if len(entry.AddrIPv4) > 0 {
		addr = entry.AddrIPv4[0].String()
	} else if len(entry.AddrIPv6) > 0 {
		addr = entry.AddrIPv6[0].String()
	} else {
		return
	}

	key := fmt.Sprintf("%s:%d", addr, entry.Port)
	name := strings.TrimSuffix(entry.Instance, "."+ServiceType)

	m.mu.Lock()
	if existing, ok := m.peers[key]; ok {
		if name != "" {
			existing.Name = name
		}
	} else {
		m.peers[key] = &Peer{Address: addr, Port: entry.Port, Name: name, Discovered: true}
		log.Printf("cluster: discovered peer %s (%s) via mDNS", key, name)
	}
	m.mu.Unlock()
}

func (m *Manager) isSelfHost(entry *zeroconf.ServiceEntry) bool {
	for _, ip := range entry.AddrIPv4 {
		if m.selfAddrs[ip.String()] {
			return true
		}
	}
	for _, ip := range entry.AddrIPv6 {
		if m.selfAddrs[ip.String()] {
			return true
		}
	}
	return false
}

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
	resp := pingResponse{Role: m.role, Mode: m.mode, ServerName: m.serverName}
	m.mu.RUnlock()
	if m.tunnelActive != nil {
		resp.TunnelActive = m.tunnelActive()
	}
	writeJSON(w, resp)
}

func (m *Manager) handleTakeover(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NewMaster string `json:"newMaster"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	m.mu.Lock()
	m.role = "slave"
	m.currentMaster = body.NewMaster
	m.lastMasterSeen = time.Now()
	m.initialSynced = false
	m.mu.Unlock()

	writeJSON(w, map[string]bool{"success": true})
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
					content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
					if err != nil {
						continue
					}
					files = append(files, plistFile{Name: entry.Name(), Content: base64.StdEncoding.EncodeToString(content)})
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
		writeJSON(w, map[string]bool{"success": false})
		return
	}

	var f plistFile
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		writeJSON(w, map[string]bool{"success": false})
		return
	}
	m.writeLocalPlist(f.Name, f.Content)
	writeJSON(w, map[string]bool{"success": true})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
