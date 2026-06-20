package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// newTestServer wires a Server around the not-implemented pmd3 stub driver, which
// is enough to exercise transport/status without a real device.
func newTestServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	drv, err := driver.New(domain.DriverPmd3, driver.Config{})
	if err != nil {
		t.Fatalf("driver.New: %v", err)
	}
	srv := New(engine.New(drv, settings.Default()), ":0")
	srv.Start()
	return httptest.NewServer(srv.Handler()), srv
}

func TestStatusREST(t *testing.T) {
	ts, _ := newTestServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var st api.Status
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.State != "idle" {
		t.Errorf("state = %q, want idle", st.State)
	}
	if st.UsbDriver != domain.DriverPmd3 {
		t.Errorf("usbDriver = %q, want pymobiledevice", st.UsbDriver)
	}
}

func TestWebSocketGreetingAndGetStatus(t *testing.T) {
	ts, _ := newTestServer(t)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

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
