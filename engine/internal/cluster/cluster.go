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
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// ServiceType is the Bonjour/mDNS service the engine advertises itself under
// (see cmd/headless's advertiseMdns) and the one this package browses for
// when discovering cluster peers automatically.
const ServiceType = "_gpsmock._tcp"

// Heartbeat/failover tuning. Seeded from env for backward compatibility, but
// now also adjustable at runtime from the web interface (SaveSettings →
// SetTuning) so operators aren't forced to restart with env vars set. Guarded
// by tuningMu and read through the accessors below; the heartbeat loop resets
// its ticker each iteration so a change takes effect within one beat.
var (
	tuningMu           sync.RWMutex
	heartbeatInterval  = envDurationOr("GPSMOCK_CLUSTER_HEARTBEAT_INTERVAL", 10*time.Second)
	masterDeadAfter    = envDurationOr("GPSMOCK_CLUSTER_MASTER_DEAD_AFTER", 30*time.Second)
	peerRequestTimeout = envDurationOr("GPSMOCK_CLUSTER_PEER_REQUEST_TIMEOUT", 3*time.Second)
)

func getHeartbeatInterval() time.Duration {
	tuningMu.RLock()
	defer tuningMu.RUnlock()
	return heartbeatInterval
}

func getMasterDeadAfter() time.Duration {
	tuningMu.RLock()
	defer tuningMu.RUnlock()
	return masterDeadAfter
}

func getPeerRequestTimeout() time.Duration {
	tuningMu.RLock()
	defer tuningMu.RUnlock()
	return peerRequestTimeout
}

// GetTuning returns the current heartbeat/failover durations — used to seed the
// status broadcast so the web UI can show the live values.
func GetTuning() (heartbeat, masterDead, peerTimeout time.Duration) {
	tuningMu.RLock()
	defer tuningMu.RUnlock()
	return heartbeatInterval, masterDeadAfter, peerRequestTimeout
}

// SetTuning updates the durations at runtime. A non-positive value leaves that
// field unchanged, so callers can update just one knob. Safe to call while the
// cluster loop is running.
func SetTuning(heartbeat, masterDead, peerTimeout time.Duration) {
	tuningMu.Lock()
	defer tuningMu.Unlock()
	if heartbeat > 0 {
		heartbeatInterval = heartbeat
	}
	if masterDead > 0 {
		masterDeadAfter = masterDead
	}
	if peerTimeout > 0 {
		peerRequestTimeout = peerTimeout
	}
}

// envDurationOr parses key as a Go duration string (e.g. "10s"); on a
// missing or unparseable value it falls back to fallback rather than failing
// startup over a malformed env var.
func envDurationOr(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		slog.Warn("cluster: invalid duration env var, using default", "key", key, "value", v, "default", fallback)
		return fallback
	}
	return d
}

// Peer is a known node in the HA cluster, manually configured or discovered
// via mDNS.
type Peer struct {
	Address    string  `json:"address"`
	Port       int     `json:"port"`
	Online     bool    `json:"online"`
	Role       string  `json:"role,omitempty"`
	Name       string  `json:"name,omitempty"`
	Discovered bool    `json:"discovered"`          // found via mDNS auto-discovery rather than manual config
	Epoch      int64   `json:"epoch,omitempty"`     // last known master epoch reported by this peer
	LatencyMs  float64 `json:"latencyMs,omitempty"` // round-trip time of the last successful ping

	lastSeen time.Time
}

func (p *Peer) key() string { return fmt.Sprintf("%s:%d", p.Address, p.Port) }

// Info is a snapshot of the cluster state, mirrored into api.Status.
type Info struct {
	Role  string `json:"role"`  // master | slave | standalone
	Mode  string `json:"mode"`  // off | manual | auto
	Epoch int64  `json:"epoch"` // current master term, for split-brain diagnostics
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

	// epoch is a monotonically increasing master "term", bumped on every
	// takeover. It fences stale takeover claims after a network partition
	// heals: a node that was master in epoch 1 and gets cut off, then comes
	// back after a peer has already become master in epoch 2, must not be
	// able to re-assert itself with its outdated epoch-1 claim.
	epoch int64

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
		client:       &http.Client{Timeout: getPeerRequestTimeout()},
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
		slog.Warn("cluster: ignoring invalid peer address", "address", addr, "error", err)
		return nil
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || !validPeerHostPort(host, port) {
		slog.Warn("cluster: ignoring invalid peer address", "address", addr)
		return nil
	}
	return &Peer{Address: host, Port: port}
}

// hostCharsRe restricts a peer hostname/IP to the characters that can
// legitimately appear there (hostnames, IPv4, bare IPv6 — brackets are
// stripped by net.SplitHostPort before this runs — and an IPv6 zone ID).
// Re-checked at every call site that turns a Peer/master key back into a
// request URL, not just when the address is first parsed, so a value that
// later flows in from a peer's own claim (e.g. an election broadcast) can't
// carry anything but a plain host:port.
var hostCharsRe = regexp.MustCompile(`^[a-zA-Z0-9.:_%-]+$`)

// validPeerHostPort reports whether host/port are safe to splice into an
// "http://host:port/..." URL: a non-empty host built only from expected
// hostname/IP characters, and a port in the valid TCP range.
func validPeerHostPort(host string, port int) bool {
	return host != "" && hostCharsRe.MatchString(host) && port > 0 && port <= 65535
}

// peerURL builds "http://host:port/path", re-validating host/port first. It
// returns ok=false instead of a malformed/unsafe URL, so callers can skip
// the request rather than send one built from an unexpected value.
func peerURL(host string, port int, path string) (string, bool) {
	if !validPeerHostPort(host, port) {
		return "", false
	}
	return fmt.Sprintf("http://%s:%d%s", host, port, path), true
}

// sanitizeFileName rejects path-traversal/separator tricks in a pairing-record
// file name before it's joined onto a directory path, whether that name came
// from a peer's sync payload or from a local os.ReadDir listing.
func sanitizeFileName(name string) (string, bool) {
	if name == "" || name == "." || name == ".." || !filepath.IsLocal(name) || strings.ContainsAny(name, `/\`) {
		return "", false
	}
	return name, true
}

func lockdownFilePath(dir, name string) (string, bool) {
	safeName, ok := sanitizeFileName(name)
	if !ok {
		return "", false
	}
	cleanDir := filepath.Clean(dir)
	target := filepath.Clean(filepath.Join(cleanDir, safeName))
	rel, err := filepath.Rel(cleanDir, target)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", false
	}
	return target, true
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
	ticker := time.NewTicker(getHeartbeatInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.checkPeers(ctx)
			m.checkMasterHealth()
			m.runCertSync(ctx)
			// Re-arm with the current interval so a runtime change from the
			// web UI (SetTuning) takes effect within one beat.
			ticker.Reset(getHeartbeatInterval())
		}
	}
}

type pingResponse struct {
	Role         string `json:"role"`
	Mode         string `json:"mode"`
	ServerName   string `json:"serverName"`
	TunnelActive bool   `json:"tunnelActive"`
	Epoch        int64  `json:"epoch"`
}

func (m *Manager) checkPeers(ctx context.Context) {
	m.mu.RLock()
	peers := make([]*Peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.mu.RUnlock()

	masterFound := ""
	var masterEpoch int64
	for _, p := range peers {
		url, ok := peerURL(p.Address, p.Port, "/api/cluster/ping")
		if !ok {
			slog.Warn("cluster: skipping peer with invalid address", "address", p.Address, "port", p.Port)
			m.mu.Lock()
			p.Online = false
			m.mu.Unlock()
			continue
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		start := time.Now()
		resp, err := m.client.Do(req)
		rtt := time.Since(start)
		if err != nil {
			m.mu.Lock()
			p.Online = false
			m.mu.Unlock()
			continue
		}
		var body pingResponse
		_ = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()

		m.mu.Lock()
		p.Online = true
		p.Role = body.Role
		p.Epoch = body.Epoch
		p.LatencyMs = float64(rtt.Microseconds()) / 1000.0
		if body.ServerName != "" {
			p.Name = body.ServerName
		}
		p.lastSeen = time.Now()
		// If several peers claim "master" in the same round (e.g. right after
		// a partition heals), trust the one with the highest epoch.
		if body.Role == "master" && body.Epoch >= masterEpoch {
			masterFound = p.key()
			masterEpoch = body.Epoch
		}
		m.mu.Unlock()
	}

	m.mu.Lock()
	if masterFound != "" {
		m.currentMaster = masterFound
		m.lastMasterSeen = time.Now()
		if masterEpoch > m.epoch {
			m.epoch = masterEpoch
		}
	} else if m.currentMaster != "" && m.currentMaster != "me" {
		m.currentMaster = ""
	}
	m.mu.Unlock()
}

func (m *Manager) checkMasterHealth() {
	m.mu.RLock()
	mode, role, master, lastSeen := m.mode, m.role, m.currentMaster, m.lastMasterSeen
	m.mu.RUnlock()

	deadAfter := getMasterDeadAfter()
	if mode == "auto" && role == "slave" && master != "" && time.Since(lastSeen) > deadAfter {
		slog.Warn("cluster: master unreachable, taking over", "master", master, "deadAfter", deadAfter)
		m.Takeover(context.Background())
	}
}

// Takeover promotes this node to master and notifies known peers. It refuses
// to do so without quorum in clusters of 3+ nodes, to avoid two halves of a
// network partition both electing themselves master at once; with fewer than
// 3 nodes a majority can't be established at all (the unreachable peer IS
// the other half of the vote), so it falls back to the timeout-only behavior
// in that case.
func (m *Manager) Takeover(ctx context.Context) {
	m.mu.Lock()
	if !m.hasQuorumLocked() {
		slog.Warn("cluster: refusing takeover, no quorum", "knownNodes", len(m.peers)+1)
		m.mu.Unlock()
		return
	}
	m.epoch++
	newEpoch := m.epoch
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
			url, ok := peerURL(p.Address, p.Port, "/api/cluster/takeover")
			if !ok {
				slog.Warn("cluster: skipping takeover broadcast, invalid peer address", "address", p.Address, "port", p.Port)
				return
			}
			body, _ := json.Marshal(map[string]any{"newMaster": "me", "epoch": newEpoch})
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := m.client.Do(req)
			if err == nil {
				_ = resp.Body.Close()
			}
		}(p)
	}
}

// hasQuorumLocked reports whether this node can currently see a strict
// majority of the cluster (itself + peers last marked Online). Must be
// called with m.mu held. Clusters smaller than 3 total nodes can never form
// a majority once the other node is unreachable, so quorum is skipped there.
func (m *Manager) hasQuorumLocked() bool {
	total := len(m.peers) + 1
	if total < 3 {
		return true
	}
	online := 1
	for _, p := range m.peers {
		if p.Online {
			online++
		}
	}
	return online*2 > total
}

// Release steps this node down from master to slave (e.g. on graceful exit).
func (m *Manager) Release() {
	m.mu.Lock()
	if m.role == "master" {
		m.role = "slave"
	}
	m.mu.Unlock()
}

// AverageLatencyMs returns the mean round-trip time of the most recent ping
// to each online peer, or 0 if there are no online peers to measure against
// (e.g. cluster mode is off, or this node is currently alone).
func (m *Manager) AverageLatencyMs() float64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var sum float64
	var n int
	for _, p := range m.peers {
		if p.Online && p.LatencyMs > 0 {
			sum += p.LatencyMs
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
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
	return Info{Role: m.role, Mode: m.mode, Epoch: m.epoch, Peers: peers}
}
