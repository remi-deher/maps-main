//go:build goiosnative

package goiosnative

import (
	"testing"

	"github.com/danielpaulus/go-ios/ios/tunnel"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// The backend must satisfy the same contracts the CLI ones do, or the engine
// silently loses the watchdog's ability to follow a device.
var (
	_ driver.Driver              = (*Driver)(nil)
	_ driver.TunnelReresolver    = (*Driver)(nil)
	_ driver.NetworkDeviceLister = (*Driver)(nil)
)

func TestRegisteredUnderItsOwnID(t *testing.T) {
	found := false
	for _, info := range driver.AvailableInfo() {
		if info.ID == domain.DriverGoIosNative {
			found = true
		}
	}
	if !found {
		t.Fatalf("driver %q not registered; available: %v", domain.DriverGoIosNative, driver.Available())
	}
}

func TestEndpointCarriesTheUserspaceProxyPort(t *testing.T) {
	// A userspace tunnel is reached through a local TCP proxy, so losing this
	// port means every injection targets an address with no route to it.
	ti, ok := endpointFrom(tunnel.Tunnel{
		Address: "fde6:1234::1", RsdPort: 54321, Udid: "udid-1",
		UserspaceTUN: true, UserspaceTUNPort: 61000,
	})
	if !ok {
		t.Fatal("expected a usable endpoint")
	}
	if ti.UserspacePort != 61000 {
		t.Errorf("UserspacePort = %d, want 61000", ti.UserspacePort)
	}
	if got, want := healthDialTarget(ti), "127.0.0.1:61000"; got != want {
		t.Errorf("health dial target = %q, want %q", got, want)
	}

	kernel, ok := endpointFrom(tunnel.Tunnel{Address: "fde6:1234::1", RsdPort: 54321, Udid: "udid-1"})
	if !ok {
		t.Fatal("expected a usable endpoint")
	}
	if kernel.UserspacePort != 0 {
		t.Errorf("kernel tunnel must carry no proxy port, got %d", kernel.UserspacePort)
	}
	if got, want := healthDialTarget(kernel), "[fde6:1234::1]:54321"; got != want {
		t.Errorf("health dial target = %q, want %q", got, want)
	}
}

func TestEndpointRejectsUnusableTunnels(t *testing.T) {
	if _, ok := endpointFrom(tunnel.Tunnel{Address: "", RsdPort: 54321}); ok {
		t.Error("a tunnel with no address must not be reported as usable")
	}
	if _, ok := endpointFrom(tunnel.Tunnel{Address: "fde6::1", RsdPort: 0}); ok {
		t.Error("a tunnel with no RSD port must not be reported as usable")
	}
}

// A manual endpoint is pinned by the user: there is no manager behind it, so
// the watchdog must be told to leave it alone rather than restart it.
func TestReresolveLeavesAManualEndpointAlone(t *testing.T) {
	d := &Driver{manual: "[fde6::1]:54321"}
	_, found, daemonAlive := d.ReresolveTunnel(t.Context())
	if found {
		t.Error("a manual endpoint has nothing to re-resolve")
	}
	if !daemonAlive {
		t.Error("a manual endpoint must never be reported as a dead daemon")
	}
}

// No manager means the tunnel is gone for good, which is the signal for the
// health monitor to restart it instead of waiting for an endpoint.
func TestReresolveReportsADeadManager(t *testing.T) {
	d := &Driver{}
	if _, _, daemonAlive := d.ReresolveTunnel(t.Context()); daemonAlive {
		t.Error("expected daemonAlive=false when no tunnel manager is running")
	}
}
