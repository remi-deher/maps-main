package goios

import (
	"context"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

func TestParseDeviceList(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []driver.Device
	}{
		{
			name: "two devices",
			in:   `{"deviceList":["udid-1","udid-2"]}`,
			want: []driver.Device{
				{UDID: "udid-1", Source: "usb"},
				{UDID: "udid-2", Source: "usb"},
			},
		},
		{
			name: "empty list",
			in:   `{"deviceList":[]}`,
			want: []driver.Device{},
		},
		{
			name: "malformed JSON degrades to nil",
			in:   `not json`,
			want: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := parseDeviceList([]byte(c.in))
			if len(got) != len(c.want) {
				t.Fatalf("got %d devices, want %d", len(got), len(c.want))
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("device[%d] = %+v, want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}

func TestStringField(t *testing.T) {
	raw := map[string]any{"DeviceName": "iPhone", "ProductVersion": 17}
	if got := stringField(raw, "DeviceName"); got != "iPhone" {
		t.Errorf("DeviceName = %q, want iPhone", got)
	}
	// Wrong type or missing key must degrade to "", not panic.
	if got := stringField(raw, "ProductVersion"); got != "" {
		t.Errorf("ProductVersion (non-string) = %q, want empty", got)
	}
	if got := stringField(raw, "Missing"); got != "" {
		t.Errorf("Missing key = %q, want empty", got)
	}
}

func TestFtoa(t *testing.T) {
	if got := ftoa(48.8566); got != "48.8566" {
		t.Errorf("ftoa(48.8566) = %q, want 48.8566", got)
	}
	if got := ftoa(-2.0); got != "-2" {
		t.Errorf("ftoa(-2.0) = %q, want -2", got)
	}
}

func TestParseTunnelList(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		wantAddr  string
		wantPort  int
		wantUDID  string
		wantEmpty bool
	}{
		{
			name:     "single tunnel with leading log line",
			in:       "{\"time\":\"...\",\"msg\":\"no udid\"}\n[{\"address\":\"fdd7:4d14:2781::1\",\"rsdPort\":65032,\"udid\":\"u-1\",\"userspaceTun\":false}]",
			wantAddr: "fdd7:4d14:2781::1", wantPort: 65032, wantUDID: "u-1",
		},
		{
			name: "powershell native command noise with empty array first",
			in: "[]\nRemoteException\n    + FullyQualifiedErrorId : NativeCommandError\n\n" +
				"[{\"address\":\"fd17:5500:62d2::1\",\"rsdPort\":65047,\"udid\":\"u-2\",\"userspaceTun\":false,\"userspaceTunPort\":0}]",
			wantAddr: "fd17:5500:62d2::1", wantPort: 65047, wantUDID: "u-2",
		},
		{name: "empty array", in: `[]`, wantEmpty: true},
		{name: "not json", in: `garbage`, wantEmpty: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := parseTunnelList([]byte(c.in))
			if c.wantEmpty {
				if len(got) != 0 {
					t.Fatalf("got %d entries, want 0", len(got))
				}
				return
			}
			if len(got) != 1 {
				t.Fatalf("got %d entries, want 1", len(got))
			}
			if got[0].Address != c.wantAddr || got[0].RsdPort != c.wantPort || got[0].UDID != c.wantUDID {
				t.Errorf("entry = %+v, want addr=%s port=%d udid=%s", got[0], c.wantAddr, c.wantPort, c.wantUDID)
			}
		})
	}
}

func TestID(t *testing.T) {
	d := &Driver{}
	if got := d.ID(); got != domain.DriverGoIos {
		t.Errorf("ID() = %q, want %q", got, domain.DriverGoIos)
	}
}

func TestTunnelReflectsState(t *testing.T) {
	d := &Driver{}
	if _, ok := d.Tunnel(); ok {
		t.Fatal("expected no tunnel before StartTunnel")
	}

	d.mount.SetActive(driver.TunnelInfo{Address: "10.0.0.1", Port: 1234}, "")

	ti, ok := d.Tunnel()
	if !ok || ti.Address != "10.0.0.1" {
		t.Fatalf("Tunnel() = %+v, %v; want active tunnel at 10.0.0.1", ti, ok)
	}
}

func TestNewBootsWithoutBinaryAndDefersError(t *testing.T) {
	// The engine must boot even when go-ios is absent, so the API/UI come up
	// and the user can see status / switch drivers; the error only surfaces
	// when an operation actually needs the binary.
	d, err := New(driver.Config{BinaryPaths: map[string]string{"go-ios": "definitely-not-a-real-binary"}})
	if err != nil {
		t.Fatalf("New must not fail when go-ios is absent: %v", err)
	}
	if d == nil {
		t.Fatal("expected a driver instance")
	}
	if _, err := d.ListDevices(context.Background()); err == nil {
		t.Error("ListDevices should surface the missing-binary error at use time")
	}
}

func TestSetClearLocationWithoutTunnelFail(t *testing.T) {
	d := &Driver{}
	ctx := context.Background()
	if err := d.SetLocation(ctx, 1, 2); err == nil {
		t.Error("SetLocation without a tunnel should fail")
	}
	if err := d.ClearLocation(ctx); err == nil {
		t.Error("ClearLocation without a tunnel should fail")
	}
}

func TestCheckHealthWithoutTunnelIsFalse(t *testing.T) {
	d := &Driver{}
	if d.CheckHealth(context.Background()) {
		t.Error("CheckHealth without a tunnel should be false")
	}
}

func TestStopTunnelNoopWhenNotStarted(t *testing.T) {
	d := &Driver{}
	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel on an inactive driver should be a no-op, got %v", err)
	}
}

func TestStartTunnelWithManualAddressSkipsProcessSpawn(t *testing.T) {
	d := &Driver{manual: "192.168.1.50:54321"}
	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel with manual address: %v", err)
	}
	if ti.Address != "192.168.1.50" || ti.Port != 54321 {
		t.Errorf("StartTunnel manual = %+v, want 192.168.1.50:54321", ti)
	}
	if got, ok := d.Tunnel(); !ok || got.Address != "192.168.1.50" {
		t.Errorf("Tunnel() after manual start = %+v, %v", got, ok)
	}

	// A second call must short-circuit on tunnelOn and return the cached info
	// rather than re-parsing — verified by changing `manual` and confirming
	// the cached value wins.
	d.manual = "10.0.0.9:1"
	ti2, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("second StartTunnel: %v", err)
	}
	if ti2.Address != "192.168.1.50" {
		t.Errorf("second StartTunnel = %+v, want cached 192.168.1.50 (not re-parsed)", ti2)
	}
}

func TestStartTunnelWithInvalidManualAddressFails(t *testing.T) {
	d := &Driver{manual: "not-a-valid-address"}
	if _, err := d.StartTunnel(context.Background()); err == nil {
		t.Error("StartTunnel with an invalid manual address should fail")
	}
}
