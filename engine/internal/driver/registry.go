package driver

import (
	"fmt"
	"sort"
	"sync"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// Config carries the runtime parameters a driver factory needs to build a
// concrete backend.
type Config struct {
	Transport   TransportKind
	Fallback    bool
	BinaryPaths map[string]string // logical name -> resolved path/command
	StorageDir  string
}

// Factory builds a Driver from a Config.
type Factory func(Config) (Driver, error)

var (
	regMu     sync.RWMutex
	factories = map[domain.DriverID]Factory{}
)

// Register makes a driver available under id. Called from init() by each
// backend.
func Register(id domain.DriverID, f Factory) {
	regMu.Lock()
	defer regMu.Unlock()
	factories[id] = f
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
