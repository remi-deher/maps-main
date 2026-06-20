// Package driver defines the abstraction over the iOS tunnel backends
// (pymobiledevice3, go-ios) and the USB/WiFi transport. The orchestrator only
// ever talks to the Driver interface; concrete backends are selected at runtime
// through the registry (the "menu").
package driver

import (
	"context"
	"errors"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// ErrNotImplemented is returned by stub drivers until phases 2-3 land the real
// go-ios / pymobiledevice3 backends.
var ErrNotImplemented = errors.New("driver not implemented")

// TunnelInfo describes an established RSD tunnel.
type TunnelInfo struct {
	Address string
	Port    int
	Type    domain.ConnectionType
	Since   time.Time
}

// Device is a discoverable iOS device.
type Device struct {
	UDID   string
	Name   string
	Source string // "usb" | "wifi" | "mdns"
}

// Driver is the lifecycle contract every iOS backend implements. Mirrors the
// legacy BaseDriver (startTunnel/stopTunnel/setLocation/clearLocation/
// checkHealth/listDevices).
type Driver interface {
	// ID returns the backend identifier (pymobiledevice | go-ios).
	ID() domain.DriverID

	// StartTunnel brings up the RSD tunnel and returns its coordinates.
	StartTunnel(ctx context.Context) (TunnelInfo, error)
	// StopTunnel tears the tunnel down.
	StopTunnel(ctx context.Context) error

	// SetLocation injects a spoofed GPS position.
	SetLocation(ctx context.Context, lat, lon float64) error
	// ClearLocation removes any spoofed position.
	ClearLocation(ctx context.Context) error

	// CheckHealth reports whether the tunnel is still reachable.
	CheckHealth(ctx context.Context) bool
	// ListDevices enumerates the devices the backend can see.
	ListDevices(ctx context.Context) ([]Device, error)

	// Tunnel returns the current tunnel info and whether one is active.
	Tunnel() (TunnelInfo, bool)
}

// DeviceDetails carries descriptive metadata about a connected device (name,
// model, serial, network address...).
type DeviceDetails struct {
	UDID           string
	Name           string
	ProductType    string
	ProductVersion string
	SerialNumber   string
	WifiAddress    string
	TunnelAddress  string
}

// DeviceInfoProvider is an optional capability: drivers able to fetch rich
// device metadata implement it. Only the go-ios backend does today —
// pymobiledevice3 support can be added later behind the same interface.
type DeviceInfoProvider interface {
	DeviceDetails(ctx context.Context) (DeviceDetails, error)
}
