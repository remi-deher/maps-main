package driver

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// Config carries the runtime parameters a driver factory needs to build a
// concrete backend.
type Config struct {
	Transport   TransportKind
	Fallback    bool
	BinaryPaths map[string]string // logical name -> resolved path/command
	StorageDir  string
	// ManualAddress, when set ("host:port"), makes the driver target this RSD
	// endpoint directly (WiFi/network transport) instead of starting a tunnel.
	ManualAddress string
	// TargetUDID, when set, pins the driver to one specific device: the tunnel
	// daemon still runs (and keeps following that device across USB/WiFi), but
	// the resolver only ever returns the tunnel whose UDID matches. Empty means
	// "first usable device". Mutually exclusive with ManualAddress in practice.
	TargetUDID string
	// TunnelStartTimeout overrides how long a driver waits for the RSD
	// address to appear before giving up on StartTunnel. Zero means "use the
	// driver's own default" (45s for go-ios, 60s for pmd3 — pmd3 additionally
	// mounts the Developer Disk Image first, which is slower).
	TunnelStartTimeout time.Duration
}

// Factory builds a Driver from a Config.
type Factory func(Config) (Driver, error)

type Capability string

const (
	CapabilityTunnelReresolve Capability = "tunnel-reresolve"
	CapabilityDeviceInfo      Capability = "device-info"
	CapabilityNetworkDevices  Capability = "network-devices"
	CapabilityPairing         Capability = "pairing"
)

type ProviderInfo struct {
	ID           domain.DriverID
	Name         string
	Capabilities []Capability
}

var (
	regMu     sync.RWMutex
	factories = map[domain.DriverID]Factory{}
	infos     = map[domain.DriverID]ProviderInfo{}
)

// Register makes a driver available under id. Called from init() by each
// backend.
func Register(id domain.DriverID, f Factory) {
	RegisterWithInfo(ProviderInfo{ID: id, Name: string(id)}, f)
}

// RegisterWithInfo makes a driver available and records its static metadata.
func RegisterWithInfo(info ProviderInfo, f Factory) {
	regMu.Lock()
	defer regMu.Unlock()
	if info.Name == "" {
		info.Name = string(info.ID)
	}
	factories[info.ID] = f
	infos[info.ID] = ProviderInfo{
		ID:           info.ID,
		Name:         info.Name,
		Capabilities: append([]Capability(nil), info.Capabilities...),
	}
}

// New instantiates the driver registered under id. This is the runtime "menu":
// the caller picks pymobiledevice or go-ios from settings/flags.
func New(id domain.DriverID, cfg Config) (Driver, error) {
	regMu.RLock()
	f, ok := factories[id]
	regMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown driver %q (available: %v)", id, Available())
	}
	return f(cfg)
}

// Available lists the registered driver IDs, sorted for stable output.
func Available() []domain.DriverID {
	regMu.RLock()
	defer regMu.RUnlock()
	ids := make([]domain.DriverID, 0, len(factories))
	for id := range factories {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

// AvailableInfo lists registered driver metadata, sorted for stable output.
func AvailableInfo() []ProviderInfo {
	regMu.RLock()
	defer regMu.RUnlock()
	out := make([]ProviderInfo, 0, len(infos))
	for _, info := range infos {
		info.Capabilities = append([]Capability(nil), info.Capabilities...)
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
