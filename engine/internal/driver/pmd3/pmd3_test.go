package pmd3

import (
	"context"
	"reflect"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

func TestNewBootsWithoutPythonAndDefersError(t *testing.T) {
	// Like the go-ios driver: New must not fail when Python is absent, so the
	// engine still boots; the error only surfaces when an operation needs it.
	d, err := New(driver.Config{BinaryPaths: map[string]string{"python": "definitely-not-a-real-python"}})
	if err != nil {
		t.Fatalf("New must not fail when python is absent: %v", err)
	}
	if d == nil {
		t.Fatal("expected a driver instance")
	}
	if _, err := d.ListDevices(context.Background()); err == nil {
		t.Error("ListDevices should surface the missing-python error at use time")
	}
}

func TestParseDeviceList(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []driver.Device
	}{
		{
			name: "two devices",
			in:   `[{"Identifier":"udid-1","DeviceName":"iPhone","ConnectionType":"USB"},{"Identifier":"udid-2","DeviceName":"iPad","ConnectionType":"Network"}]`,
			want: []driver.Device{
				{UDID: "udid-1", Name: "iPhone", Source: "USB"},
				{UDID: "udid-2", Name: "iPad", Source: "Network"},
			},
		},
		{
			name: "empty list",
			in:   `[]`,
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

func TestFtoa(t *testing.T) {
	if got := ftoa(48.8566); got != "48.8566" {
		t.Errorf("ftoa(48.8566) = %q, want 48.8566", got)
	}
	if got := ftoa(-2.0); got != "-2" {
		t.Errorf("ftoa(-2.0) = %q, want -2", got)
	}
}

func TestArgsPrependsBase(t *testing.T) {
	d := &Driver{base: []string{"-m", "pymobiledevice3"}}
	got := d.args("usbmux", "list")
	want := []string{"-m", "pymobiledevice3", "usbmux", "list"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("args(...) = %v, want %v", got, want)
	}
	// args() must not mutate d.base on repeated calls.
	d.args("developer", "dvt")
	if !reflect.DeepEqual(d.base, []string{"-m", "pymobiledevice3"}) {
		t.Errorf("d.base mutated: %v", d.base)
	}
}

func TestID(t *testing.T) {
	d := &Driver{}
	if got := d.ID(); got != domain.DriverPmd3 {
		t.Errorf("ID() = %q, want %q", got, domain.DriverPmd3)
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

	// A second call must short-circuit on tunnelOn and return the cached
	// info rather than re-parsing.
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

func TestParseTunneldFiltersByUDID(t *testing.T) {
	body := []byte(`{
		"UDID-A":[{"tunnel-address":"fd00::a","tunnel-port":111,"interface":"utun0"}],
		"UDID-B":[{"tunnel-address":"fd00::b","tunnel-port":222,"interface":"utun1"}]
	}`)

	// With a target UDID, only that device's tunnel is returned.
	ep, ok := parseTunneld(body, "UDID-B")
	if !ok {
		t.Fatal("expected a tunnel for UDID-B")
	}
	if ep.UDID != "UDID-B" || ep.Info.Address != "fd00::b" || ep.Info.Port != 222 {
		t.Fatalf("got %s %s:%d, want UDID-B fd00::b:222", ep.UDID, ep.Info.Address, ep.Info.Port)
	}

	// A target UDID that isn't present yields no endpoint.
	if _, ok := parseTunneld(body, "UDID-MISSING"); ok {
		t.Fatal("expected no tunnel for an absent UDID")
	}

	// No filter falls back to first usable.
	if _, ok := parseTunneld(body, ""); !ok {
		t.Fatal("expected a tunnel with no UDID filter")
	}
}
