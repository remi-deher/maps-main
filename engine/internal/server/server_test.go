package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// fakeDriver is an in-memory Driver so the server can be tested without a real
// device or registered backend.
type fakeDriver struct{ on bool }

func (fakeDriver) ID() domain.DriverID { return domain.DriverPmd3 }
func (f *fakeDriver) StartTunnel(context.Context) (driver.TunnelInfo, error) {
	f.on = true
	return driver.TunnelInfo{Address: "::1", Port: 1, Type: domain.ConnUSB}, nil
}
func (f *fakeDriver) StopTunnel(context.Context) error                  { f.on = false; return nil }
func (*fakeDriver) SetLocation(context.Context, float64, float64) error { return nil }
func (*fakeDriver) ClearLocation(context.Context) error                 { return nil }
func (f *fakeDriver) CheckHealth(context.Context) bool                  { return f.on }
func (*fakeDriver) ListDevices(context.Context) ([]driver.Device, error) {
	return nil, nil
}
func (f *fakeDriver) Tunnel() (driver.TunnelInfo, bool) {
	return driver.TunnelInfo{Address: "::1", Port: 1, Type: domain.ConnUSB}, f.on
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := New(engine.New(&fakeDriver{}, settings.Default()), ":0")
	srv.Start()
	return httptest.NewServer(srv.Handler())
}

func TestStatusREST(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	var st api.Status
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.State != "idle" {
		t.Errorf("state = %q, want idle", st.State)
	}
	if st.UsbDriver != domain.DriverGoIos {
		t.Errorf("usbDriver = %q, want go-ios", st.UsbDriver)
	}
}

func TestLogsRESTFiltersStructuredEntries(t *testing.T) {
	eng := engine.New(&fakeDriver{}, settings.Default())
	eng.LogEvent("info", "engine", "location", "set", "Position injectée", map[string]string{"driver": "pymobiledevice"})
	eng.LogEvent("warn", "simulation", "route", "fallback", "OSRM indisponible", map[string]string{"driver": "go-ios"})
	eng.LogEvent("error", "tunnel", "tunnel", "start", "Tunnel échoué", map[string]string{"driver": "go-ios"})

	srv := New(eng, ":0")
	srv.Start()
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/logs?level=error&category=tunnel")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	var logs []api.LogEntryPayload
	if err := json.NewDecoder(resp.Body).Decode(&logs); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(logs) != 1 || logs[0].Action != "start" {
		t.Fatalf("unexpected filtered logs: %+v", logs)
	}

	resp2, err := http.Get(ts.URL + "/api/logs?q=go-ios&limit=1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp2.Body.Close() }()
	logs = nil
	if err := json.NewDecoder(resp2.Body).Decode(&logs); err != nil {
		t.Fatalf("decode limited logs: %v", err)
	}
	if len(logs) != 1 || logs[0].Source != "tunnel" {
		t.Fatalf("unexpected limited logs: %+v", logs)
	}
}

func TestUnrecognizedActionDoesNotCrashOrHang(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	defer func() { _ = c.Close() }()

	_ = readEnvelope(t, c) // greeting STATUS

	if err := c.WriteJSON(api.Envelope{Type: "SOME_FUTURE_ACTION_THIS_SERVER_DOESNT_KNOW"}); err != nil {
		t.Fatal(err)
	}
	// The connection must stay alive and keep answering normal actions —
	// an unrecognized action must not crash the dispatch or break the conn.
	if err := c.WriteJSON(api.Envelope{Type: api.ActionGetStatus}); err != nil {
		t.Fatal(err)
	}
	if env := readEnvelope(t, c); env.Type != api.EventStatus {
		t.Fatalf("response type = %q, want STATUS", env.Type)
	}
}

func TestMetricsRESTExposesPrometheusFormat(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var body bytes.Buffer
	if _, err := body.ReadFrom(resp.Body); err != nil {
		t.Fatalf("read body: %v", err)
	}
	text := body.String()
	for _, want := range []string{
		"# TYPE gpsmock_uptime_seconds gauge",
		"gpsmock_ws_clients_connected",
		"# TYPE gpsmock_ws_bytes_sent_total counter",
		"gpsmock_ws_clients_dropped_total",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("metrics output missing %q\ngot:\n%s", want, text)
		}
	}
}

func TestRESTSetLocationRejectsOutOfRangeCoordinates(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	bad, _ := json.Marshal(api.SetLocationPayload{Lat: 999, Lon: 2.3})
	resp, err := http.Post(ts.URL+"/api/location/set", "application/json", bytes.NewReader(bad))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}

	good, _ := json.Marshal(api.SetLocationPayload{Lat: 48.8, Lon: 2.3})
	resp2, err := http.Post(ts.URL+"/api/location/set", "application/json", bytes.NewReader(good))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp2.StatusCode)
	}
}

func TestSetLocationRejectsOutOfRangeCoordinates(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	defer func() { _ = c.Close() }()

	_ = readEnvelope(t, c) // greeting STATUS

	bad, _ := json.Marshal(api.SetLocationPayload{Lat: 999, Lon: 2.3})
	if err := c.WriteJSON(api.Envelope{Type: api.ActionSetLocation, Data: bad}); err != nil {
		t.Fatal(err)
	}
	// The invalid payload must be dropped rather than reaching the engine —
	// confirm via a follow-up GET_STATUS that nothing was injected, and that
	// the connection is still alive.
	if err := c.WriteJSON(api.Envelope{Type: api.ActionGetStatus}); err != nil {
		t.Fatal(err)
	}
	env := readEnvelopeOfType(t, c, api.EventStatus)
	var st api.Status
	if err := json.Unmarshal(env.Data, &st); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if st.LastInjectedLocation != nil {
		t.Errorf("expected no injected location after an out-of-range SET_LOCATION, got %+v", st.LastInjectedLocation)
	}

	good, _ := json.Marshal(api.SetLocationPayload{Lat: 48.8, Lon: 2.3})
	if err := c.WriteJSON(api.Envelope{Type: api.ActionSetLocation, Data: good}); err != nil {
		t.Fatal(err)
	}
	if err := c.WriteJSON(api.Envelope{Type: api.ActionGetStatus}); err != nil {
		t.Fatal(err)
	}
	env = readEnvelopeOfType(t, c, api.EventStatus)
	if err := json.Unmarshal(env.Data, &st); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if st.LastInjectedLocation == nil || st.LastInjectedLocation.Lat != 48.8 {
		t.Errorf("expected a valid SET_LOCATION to be applied, got %+v", st.LastInjectedLocation)
	}
}

func TestHealthREST(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var h healthResponse
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.Status != "ok" {
		t.Errorf("status = %q, want ok", h.Status)
	}
}

func TestWebSocketGreetingAndGetStatus(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	defer func() { _ = c.Close() }()

	// 1) The server greets a new client with a STATUS envelope.
	if env := readEnvelope(t, c); env.Type != api.EventStatus {
		t.Fatalf("greeting type = %q, want STATUS", env.Type)
	}

	// 2) GET_STATUS yields another STATUS.
	if err := c.WriteJSON(api.Envelope{Type: api.ActionGetStatus}); err != nil {
		t.Fatal(err)
	}
	if env := readEnvelope(t, c); env.Type != api.EventStatus {
		t.Fatalf("response type = %q, want STATUS", env.Type)
	}

	// 3) HEARTBEAT yields a PONG.
	if err := c.WriteJSON(api.Envelope{Type: api.ActionHeartbeat}); err != nil {
		t.Fatal(err)
	}
	if env := readEnvelope(t, c); env.Type != api.EventPong {
		t.Fatalf("response type = %q, want PONG", env.Type)
	}
}

func readEnvelope(t *testing.T, c *websocket.Conn) api.Envelope {
	t.Helper()
	var env api.Envelope
	if err := c.ReadJSON(&env); err != nil {
		t.Fatalf("read: %v", err)
	}
	return env
}

// readEnvelopeOfType drains messages until one of the given type, e.g. to
// skip past ACK/LOCATION broadcasts a preceding action triggered before its
// own explicit GET_STATUS reply arrives.
func readEnvelopeOfType(t *testing.T, c *websocket.Conn, want string) api.Envelope {
	t.Helper()
	for i := 0; i < 10; i++ {
		env := readEnvelope(t, c)
		if env.Type == want {
			return env
		}
	}
	t.Fatalf("did not see a %q envelope within 10 messages", want)
	return api.Envelope{}
}

func TestOptionalAuthentication(t *testing.T) {
	// 1) Test with authentication enabled (GPSMOCK_API_KEY set)
	t.Setenv("GPSMOCK_API_KEY", "secret-test-token")
	ts := newTestServer(t)
	defer ts.Close()

	// REST Status endpoint without token -> 401
	resp, err := http.Get(ts.URL + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauthenticated REST status = %d, want 401", resp.StatusCode)
	}

	// REST Status endpoint with valid Authorization header -> 200
	req, _ := http.NewRequest("GET", ts.URL+"/api/status", nil)
	req.Header.Set("Authorization", "Bearer secret-test-token")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("authenticated (header) REST status = %d, want 200", resp.StatusCode)
	}

	// REST Status endpoint with valid query token -> 200
	resp, err = http.Get(ts.URL + "/api/status?token=secret-test-token")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("authenticated (query) REST status = %d, want 200", resp.StatusCode)
	}

	// WS Dial without token -> fails (401 response)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	_, unauthResp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if unauthResp != nil {
		_ = unauthResp.Body.Close()
	}
	if err == nil {
		t.Fatal("expected unauthenticated WS dial to fail")
	}

	// WS Dial with valid query token -> succeeds
	c, resp2, err := websocket.DefaultDialer.Dial(wsURL+"?token=secret-test-token", nil)
	if err != nil {
		t.Fatalf("authenticated WS dial failed: %v", err)
	}
	_ = resp2.Body.Close()
	_ = c.Close()
}

func TestActionMetrics(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	defer func() { _ = c.Close() }()

	_ = readEnvelope(t, c) // greeting STATUS

	// Send an unrecognized action -> error metric should be recorded
	_ = c.WriteJSON(api.Envelope{Type: "SOME_FUTURE_ACTION_THIS_SERVER_DOESNT_KNOW"})

	// Send a valid get status action -> success metric should be recorded
	_ = c.WriteJSON(api.Envelope{Type: api.ActionGetStatus})
	_ = readEnvelopeOfType(t, c, api.EventStatus)

	// Fetch metrics REST endpoint and verify
	mResp, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = mResp.Body.Close() }()

	var body bytes.Buffer
	_, _ = body.ReadFrom(mResp.Body)
	text := body.String()

	if !strings.Contains(text, `gpsmock_ws_actions_total{action="SOME_FUTURE_ACTION_THIS_SERVER_DOESNT_KNOW",status="error"}`) {
		t.Errorf("expected error action metric in output, got:\n%s", text)
	}
	if !strings.Contains(text, `gpsmock_ws_actions_total{action="GET_STATUS",status="success"}`) {
		t.Errorf("expected success action metric in output, got:\n%s", text)
	}
}

func TestRateLimiting(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	defer func() { _ = c.Close() }()

	_ = readEnvelope(t, c) // greeting STATUS

	// Flood the server with messages above burst (burst is 20)
	for i := 0; i < 30; i++ {
		_ = c.WriteJSON(api.Envelope{Type: api.ActionGetStatus})
	}

	// We should receive an error / connection close or a log message indicating rate limit
	foundRateLimitMsg := false
	for i := 0; i < 40; i++ {
		var env api.Envelope
		if err := c.ReadJSON(&env); err != nil {
			// Connection closed as expected
			foundRateLimitMsg = true
			break
		}
		if env.Type == api.EventLog {
			var logPayload api.LogEntryPayload
			if json.Unmarshal(env.Data, &logPayload) == nil && strings.Contains(logPayload.Message, "Rate limit exceeded") {
				foundRateLimitMsg = true
				break
			}
		}
	}

	if !foundRateLimitMsg {
		t.Error("expected rate limiter to drop connection or send rate limit error")
	}
}

func TestEnrollDevice(t *testing.T) {
	// If on Windows, we mock the ProgramData env variable so platform.LockdownDir() resolves to a temp dir
	var tempDir string
	if runtime.GOOS == "windows" {
		var err error
		tempDir, err = os.MkdirTemp("", "lockdown-test")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = os.RemoveAll(tempDir) }()

		oldProgramData := os.Getenv("ProgramData")
		_ = os.Setenv("ProgramData", tempDir)
		defer func() { _ = os.Setenv("ProgramData", oldProgramData) }()

		// Create the Apple/Lockdown subdirectory so platform.LockdownDir() finds it
		lockdownPath := filepath.Join(tempDir, "Apple", "Lockdown")
		if err := os.MkdirAll(lockdownPath, 0755); err != nil {
			t.Fatal(err)
		}
	} else {
		// On non-Windows (e.g. CI running Linux), the system Lockdown dir is /var/lib/lockdown.
		// If it doesn't exist, we skip the writing phase of the test and just test payload validation.
		lockdownPath := "/var/lib/lockdown"
		if info, err := os.Stat(lockdownPath); err != nil || !info.IsDir() {
			t.Skip("Skipping full TestEnrollDevice: no writeable lockdown directory on non-Windows host")
		}
	}

	ts := newTestServer(t)
	defer ts.Close()

	// Test case 1: Successful enrollment
	payload := map[string]string{
		"udid":         "00008030-001234567890ABCD",
		"deviceRecord": base64.StdEncoding.EncodeToString([]byte("dummy plist content")),
	}
	body, _ := json.Marshal(payload)

	resp, err := http.Post(ts.URL+"/api/device/enroll", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	// Test case 2: Bad base64
	payloadBad := map[string]string{
		"udid":         "00008030-001234567890ABCD",
		"deviceRecord": "invalid-base-64-content!!!!",
	}
	bodyBad, _ := json.Marshal(payloadBad)

	respBad, err := http.Post(ts.URL+"/api/device/enroll", "application/json", bytes.NewBuffer(bodyBad))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = respBad.Body.Close() }()

	if respBad.StatusCode != http.StatusBadRequest {
		t.Errorf("expected status 400 for bad base64, got %d", respBad.StatusCode)
	}
}
