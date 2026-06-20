package server

import (
	"context"
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

func newTestServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	srv := New(engine.New(&fakeDriver{}, settings.Default()), ":0")
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
