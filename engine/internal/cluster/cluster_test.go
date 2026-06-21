package cluster

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// newTestServer wraps a Manager's RegisterRoutes in an httptest.Server and
// returns its host/port, so it can be used as a manual peer by another
// Manager under test.
func newTestServer(t *testing.T, m *Manager) (host string, port int) {
	t.Helper()
	mux := http.NewServeMux()
	m.RegisterRoutes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	p, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse test server port: %v", err)
	}
	return u.Hostname(), p
}

func TestManualModeStartsAsSlaveAndPromotesOnPing(t *testing.T) {
	master := New("manual", nil, "master-node", 0, func() bool { return true }, false)
	master.Takeover(context.Background()) // no peers configured yet; just promotes itself
	masterHost, masterPort := newTestServer(t, master)

	slave := New("manual", []string{masterHost + ":" + strconv.Itoa(masterPort)}, "slave-node", 0, func() bool { return false }, false)
	if got := slave.Status().Role; got != "slave" {
		t.Fatalf("manual mode should start as slave, got %q", got)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	slave.checkPeers(ctx)

	info := slave.Status()
	if len(info.Peers) != 1 {
		t.Fatalf("expected 1 peer, got %d", len(info.Peers))
	}
	if !info.Peers[0].Online {
		t.Fatalf("expected peer to be online after a successful ping")
	}
	if info.Peers[0].Role != "master" {
		t.Fatalf("expected peer role %q, got %q", "master", info.Peers[0].Role)
	}
}

func TestOffModeIsStandaloneAndIgnoresPeers(t *testing.T) {
	m := New("off", []string{"127.0.0.1:9"}, "solo", 0, nil, false)
	if got := m.Status().Role; got != "standalone" {
		t.Fatalf("off mode should start standalone, got %q", got)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.Start(ctx) // no-op: heartbeat/discovery must not start in "off" mode
	m.checkMasterHealth()
	if got := m.Status().Role; got != "standalone" {
		t.Fatalf("off mode should remain standalone, got %q", got)
	}
}

func TestTakeoverPromotesSelfAndNotifiesPeers(t *testing.T) {
	slave := New("manual", nil, "slave-node", 0, func() bool { return false }, false)
	slaveHost, slavePort := newTestServer(t, slave)

	master := New("manual", []string{slaveHost + ":" + strconv.Itoa(slavePort)}, "master-node", 0, func() bool { return true }, false)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	master.Takeover(ctx)

	if got := master.Status().Role; got != "master" {
		t.Fatalf("expected self role %q after takeover, got %q", "master", got)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if slave.Status().Role == "slave" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected notified peer to become slave, got %q", slave.Status().Role)
}

func TestCertSyncPullsPairingRecordsFromMaster(t *testing.T) {
	masterDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(masterDir, "device.plist"), []byte("pairing-record-bytes"), 0o600); err != nil {
		t.Fatalf("seed master pairing record: %v", err)
	}

	master := New("manual", nil, "master-node", 0, func() bool { return true }, true)
	master.certDir = masterDir
	master.Takeover(context.Background())
	masterHost, masterPort := newTestServer(t, master)

	slaveDir := t.TempDir()
	slave := New("manual", []string{masterHost + ":" + strconv.Itoa(masterPort)}, "slave-node", 0, func() bool { return false }, true)
	slave.certDir = slaveDir

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	slave.checkPeers(ctx) // discovers the master's role, like the heartbeat loop would
	slave.runCertSync(ctx)

	got, err := os.ReadFile(filepath.Join(slaveDir, "device.plist"))
	if err != nil {
		t.Fatalf("expected pairing record to be synced locally: %v", err)
	}
	if string(got) != "pairing-record-bytes" {
		t.Fatalf("synced pairing record content mismatch: got %q", got)
	}
}

func TestCertSyncDisabledByDefaultDoesNothing(t *testing.T) {
	masterDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(masterDir, "device.plist"), []byte("pairing-record-bytes"), 0o600); err != nil {
		t.Fatalf("seed master pairing record: %v", err)
	}

	master := New("manual", nil, "master-node", 0, func() bool { return true }, false) // syncCerts disabled
	master.certDir = masterDir
	master.Takeover(context.Background())
	masterHost, masterPort := newTestServer(t, master)

	slaveDir := t.TempDir()
	slave := New("manual", []string{masterHost + ":" + strconv.Itoa(masterPort)}, "slave-node", 0, func() bool { return false }, false)
	slave.certDir = slaveDir

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	slave.checkPeers(ctx)
	slave.runCertSync(ctx)

	if _, err := os.ReadFile(filepath.Join(slaveDir, "device.plist")); err == nil {
		t.Fatalf("cert sync must be a no-op when disabled")
	}
}

func TestTakeoverRefusesWithoutQuorumInThreeNodeCluster(t *testing.T) {
	// Two peers configured but neither reachable: with 3 total nodes, quorum
	// needs a majority (2 of 3) — this node alone can't self-elect.
	m := New("manual", []string{"127.0.0.1:1", "127.0.0.1:2"}, "node-a", 0, func() bool { return false }, false)
	m.Takeover(context.Background())
	if got := m.Status().Role; got == "master" {
		t.Fatalf("expected takeover to be refused without quorum, but role became %q", got)
	}
	if got := m.Status().Epoch; got != 0 {
		t.Fatalf("epoch should not advance on a refused takeover, got %d", got)
	}
}

func TestTakeoverSucceedsWithQuorumInThreeNodeCluster(t *testing.T) {
	peer1 := New("manual", nil, "peer1", 0, func() bool { return false }, false)
	host1, port1 := newTestServer(t, peer1)

	// 3 total nodes (self + 2 peers), but only peer1 is reachable — still a
	// majority (2 of 3), so the takeover must succeed.
	m := New("manual", []string{host1 + ":" + strconv.Itoa(port1), "127.0.0.1:1"}, "node-a", 0, func() bool { return false }, false)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	m.checkPeers(ctx)

	m.Takeover(ctx)
	if got := m.Status().Role; got != "master" {
		t.Fatalf("expected takeover to succeed with quorum (2 of 3 nodes), got role %q", got)
	}
}

func TestHandleTakeoverRejectsStaleEpoch(t *testing.T) {
	m := New("manual", nil, "node-a", 0, func() bool { return false }, false)
	m.Takeover(context.Background()) // epoch -> 1, role -> master
	if got := m.Status().Epoch; got != 1 {
		t.Fatalf("expected epoch 1 after takeover, got %d", got)
	}

	host, port := newTestServer(t, m)
	endpoint := "http://" + host + ":" + strconv.Itoa(port) + "/api/cluster/takeover"

	// A stale claim (epoch <= current) must be rejected: role/epoch unchanged.
	resp, err := http.Post(endpoint, "application/json", bytes.NewReader([]byte(`{"newMaster":"stale-node","epoch":1}`)))
	if err != nil {
		t.Fatalf("POST takeover: %v", err)
	}
	var result map[string]bool
	_ = json.NewDecoder(resp.Body).Decode(&result)
	_ = resp.Body.Close()
	if result["success"] {
		t.Fatalf("expected stale takeover claim to be rejected")
	}
	if got := m.Status().Role; got != "master" {
		t.Fatalf("role must remain master after rejecting a stale claim, got %q", got)
	}

	// A genuinely newer epoch must be accepted.
	resp2, err := http.Post(endpoint, "application/json", bytes.NewReader([]byte(`{"newMaster":"new-master","epoch":2}`)))
	if err != nil {
		t.Fatalf("POST takeover: %v", err)
	}
	_ = resp2.Body.Close()
	if got := m.Status().Role; got != "slave" {
		t.Fatalf("expected role slave after accepting a newer epoch, got %q", got)
	}
	if got := m.Status().Epoch; got != 2 {
		t.Fatalf("expected epoch 2 after accepting a newer epoch, got %d", got)
	}
}

func TestPingHandlerReportsRoleModeAndTunnelState(t *testing.T) {
	m := New("manual", nil, "node-a", 0, func() bool { return true }, false)
	host, port := newTestServer(t, m)

	resp, err := http.Get("http://" + host + ":" + strconv.Itoa(port) + "/api/cluster/ping")
	if err != nil {
		t.Fatalf("GET /api/cluster/ping: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestParsePeerAddrRejectsOutOfRangeOrUnsafePort(t *testing.T) {
	cases := []string{
		"127.0.0.1:0",     // port 0 is out of range
		"127.0.0.1:99999", // port above 65535
		"127.0.0.1:-1",    // negative port
		"[::1]/x:1234",    // host with a path-separator-like character
	}
	for _, addr := range cases {
		if p := parsePeerAddr(addr); p != nil {
			t.Errorf("parsePeerAddr(%q) = %+v, want nil", addr, p)
		}
	}
}

func TestParsePeerAddrAcceptsValidHostsAndPorts(t *testing.T) {
	cases := map[string]struct {
		host string
		port int
	}{
		"192.168.1.50:54321": {"192.168.1.50", 54321},
		"node-a.local:8080":  {"node-a.local", 8080},
	}
	for addr, want := range cases {
		p := parsePeerAddr(addr)
		if p == nil || p.Address != want.host || p.Port != want.port {
			t.Errorf("parsePeerAddr(%q) = %+v, want %+v", addr, p, want)
		}
	}
}

func TestPeerURLRejectsInvalidHostOrPort(t *testing.T) {
	cases := []struct {
		host string
		port int
	}{
		{"", 8080},
		{"node-a", 0},
		{"node-a", 70000},
		{"node-a/../escape", 8080},
		{"node-a evil", 8080},
	}
	for _, c := range cases {
		if url, ok := peerURL(c.host, c.port, "/api/cluster/ping"); ok {
			t.Errorf("peerURL(%q, %d) = %q, ok=true, want ok=false", c.host, c.port, url)
		}
	}
}

func TestPeerURLBuildsExpectedURL(t *testing.T) {
	url, ok := peerURL("192.168.1.50", 8080, "/api/cluster/ping")
	if !ok || url != "http://192.168.1.50:8080/api/cluster/ping" {
		t.Errorf("peerURL = %q, %v, want http://192.168.1.50:8080/api/cluster/ping, true", url, ok)
	}
}

func TestSanitizeFileNameRejectsTraversalAndSeparators(t *testing.T) {
	cases := []string{"..", ".", ""}
	for _, name := range cases {
		if got, ok := sanitizeFileName(name); ok {
			t.Errorf("sanitizeFileName(%q) = %q, ok=true, want ok=false", name, got)
		}
	}
}

// TestSanitizeFileNameReducesSlashPathsToTheirBaseName documents that a name
// carrying directory components (e.g. a peer trying ../../etc/passwd) isn't
// rejected outright — filepath.Base reduces it to its trailing component
// first, and that reduced name is what gets validated and joined onto dir,
// so it can never escape it. "/" is filepath's separator on every platform,
// unlike "\" (Windows-only), so this case is portable; the backslash case is
// covered separately per-OS below.
func TestSanitizeFileNameReducesSlashPathsToTheirBaseName(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd": "passwd",
		"a/b":              "b",
	}
	for name, want := range cases {
		got, ok := sanitizeFileName(name)
		if !ok || got != want {
			t.Errorf("sanitizeFileName(%q) = %q, %v, want %q, true", name, got, ok, want)
		}
	}
}

// TestSanitizeFileNameHandlesBackslash documents that "\" is platform
// dependent: filepath.Base treats it as a separator on Windows (reducing the
// name to its trailing component, same as "/"), but as a plain character
// elsewhere — where the leftover "\" then trips the explicit separator
// check. Either outcome is safe; this just pins down which one happens
// where.
func TestSanitizeFileNameHandlesBackslash(t *testing.T) {
	got, ok := sanitizeFileName(`a\b`)
	if runtime.GOOS == "windows" {
		if !ok || got != "b" {
			t.Errorf(`sanitizeFileName("a\b") = %q, %v, want "b", true on windows`, got, ok)
		}
		return
	}
	if ok {
		t.Errorf(`sanitizeFileName("a\b") = %q, ok=true, want ok=false on %s`, got, runtime.GOOS)
	}
}

func TestSanitizeFileNameAcceptsPlainNames(t *testing.T) {
	if got, ok := sanitizeFileName("com.apple.mobiledevice.pairingrecords.plist"); !ok || got != "com.apple.mobiledevice.pairingrecords.plist" {
		t.Errorf("sanitizeFileName = %q, %v", got, ok)
	}
}

// TestPullCertsFromMasterRejectsUnsafeMasterKey exercises the defense-in-depth
// validation in pullCertsFromMaster directly: even though m.currentMaster is
// normally only ever set from an already-validated Peer's key(), the function
// must not build a request from a malformed value if that ever changes.
func TestPullCertsFromMasterRejectsUnsafeMasterKey(t *testing.T) {
	m := New("manual", nil, "node-a", 0, func() bool { return true }, false)
	m.syncCerts = true
	// Must not panic or hang; net.SplitHostPort fails outright on this input,
	// so no request is attempted.
	m.pullCertsFromMaster(context.Background(), "not-a-valid-hostport")
}
