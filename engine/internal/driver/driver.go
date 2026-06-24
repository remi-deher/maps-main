// Package driver defines the abstraction over the iOS tunnel backends
// (pymobiledevice3, go-ios) and the USB/WiFi transport. The orchestrator only
// ever talks to the Driver interface; concrete backends are selected at runtime
// through the registry (the "menu").
package driver

import (
	"context"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

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
// TunnelManager handles establishing and tearing down connection tunnels.
type TunnelManager interface {
	// StartTunnel brings up the RSD tunnel and returns its coordinates.
	StartTunnel(ctx context.Context) (TunnelInfo, error)
	// StopTunnel tears the tunnel down.
	StopTunnel(ctx context.Context) error
	// Tunnel returns the current tunnel info and whether one is active.
	Tunnel() (TunnelInfo, bool)
}

// LocationSimulator handles spoofing and clearing GPS coordinates.
type LocationSimulator interface {
	// SetLocation injects a spoofed GPS position.
	SetLocation(ctx context.Context, lat, lon float64) error
	// ClearLocation removes any spoofed position.
	ClearLocation(ctx context.Context) error
}

// DeviceLister lists available iOS devices.
type DeviceLister interface {
	// ListDevices enumerates the devices the backend can see.
	ListDevices(ctx context.Context) ([]Device, error)
}

// HealthChecker checks the active status of the driver connection.
type HealthChecker interface {
	// CheckHealth reports whether the tunnel is still reachable.
	CheckHealth(ctx context.Context) bool
}

// Driver is the composite contract representing a full-featured backend.
type Driver interface {
	// ID returns the backend identifier (pymobiledevice | go-ios).
	ID() domain.DriverID
	TunnelManager
	LocationSimulator
	DeviceLister
	HealthChecker
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

// NetworkDevice is one RSD endpoint a tunnel daemon already knows about —
// go-ios's `ios tunnel ls` and pymobiledevice3's `remote tunneld` REST API both
// auto-discover every paired Apple device reachable on the LAN (over mDNS/
// Bonjour) and keep a live tunnel per UDID, so this list reflects devices found
// that way, not a browse we perform ourselves.
type NetworkDevice struct {
	UDID    string
	Address string // host (IPv6 ULA, bracket if embedding in host:port)
	Port    int
}

// NetworkDeviceLister is an optional capability: drivers whose tunnel daemon
// exposes every currently-known device (not just the one StartTunnel picked)
// implement it, so a client can offer a device picker instead of a free-text
// manual address field. Both go-ios and pymobiledevice3 implement it.
type NetworkDeviceLister interface {
	ListNetworkDevices(ctx context.Context) ([]NetworkDevice, error)
}

// TunnelReresolver is an optional capability: drivers that can refresh the
// active tunnel's endpoint for the current device without restarting the daemon
// implement it, so the health monitor can transparently follow a device moving
// between USB and WiFi. Returns the (possibly unchanged) info and ok=true when a
// tunnel exists now; ok=false with daemonAlive=false signals the caller to
// restart the daemon. Both go-ios and pymobiledevice3 implement it.
type TunnelReresolver interface {
	ReresolveTunnel(ctx context.Context) (info TunnelInfo, ok bool, daemonAlive bool)
}
