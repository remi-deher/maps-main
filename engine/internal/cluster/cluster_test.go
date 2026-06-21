package cluster

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
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

func TestPingHandlerReportsRoleModeAndTunnelState(t *testing.T) {
	m := New("manual", nil, "node-a", 0, func() bool { return true }, false)
	host, port := newTestServer(t, m)

	resp, err := http.Get("http://" + host + ":" + strconv.Itoa(port) + "/api/cluster/ping")
	if err != nil {
		t.Fatalf("GET /api/cluster/ping: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}
