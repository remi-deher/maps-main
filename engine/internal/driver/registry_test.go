package driver

import (
	"context"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

type registryTestDriver struct{}

func (registryTestDriver) ID() domain.DriverID { return "registry-test" }
func (registryTestDriver) StartTunnel(context.Context) (TunnelInfo, error) {
	return TunnelInfo{}, nil
}
func (registryTestDriver) StopTunnel(context.Context) error { return nil }
func (registryTestDriver) Tunnel() (TunnelInfo, bool)       { return TunnelInfo{}, false }
func (registryTestDriver) SetLocation(context.Context, float64, float64) error {
	return nil
}
func (registryTestDriver) ClearLocation(context.Context) error { return nil }
func (registryTestDriver) ListDevices(context.Context) ([]Device, error) {
	return nil, nil
}
func (registryTestDriver) CheckHealth(context.Context) bool { return true }

func TestRegisterWithInfoStoresProviderMetadata(t *testing.T) {
	id := domain.DriverID("registry-test")
	RegisterWithInfo(ProviderInfo{
		ID:           id,
		Name:         "Registry Test",
		Capabilities: []Capability{CapabilityPairing, CapabilityNetworkDevices},
	}, func(Config) (Driver, error) {
		return registryTestDriver{}, nil
	})

	got, err := New(id, Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got.ID() != id {
		t.Fatalf("driver id = %q, want %q", got.ID(), id)
	}

	var found ProviderInfo
	for _, info := range AvailableInfo() {
		if info.ID == id {
			found = info
			break
		}
	}
	if found.ID != id {
		t.Fatalf("provider metadata not found in AvailableInfo")
	}
	if found.Name != "Registry Test" {
		t.Fatalf("provider name = %q", found.Name)
	}
	if len(found.Capabilities) != 2 {
		t.Fatalf("capabilities = %v", found.Capabilities)
	}
}
