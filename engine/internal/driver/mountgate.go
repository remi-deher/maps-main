package driver

import (
	"sync"
	"time"
)

// MountGate keeps StartTunnel from re-mounting the Developer Disk Image it
// already knows is mounted.
//
// The mount is a prerequisite for every DVT service, location simulation
// included, so both backends run it before every tunnel attempt. It is also the
// single most expensive step: on iOS 17+ the image is personalized through
// Apple's signing server, which is why it is bounded at 30-60s. The health
// monitor retries a failed tunnel every 30s to 5min, and each retry paid that
// cost again — while holding the engine's tunnel lock — to redo something that
// is device-side state and had not changed in the meantime.
//
// The gate is deliberately a cache of *observed success only*. A mount that
// failed, or whose state could not be read, is never remembered: that is the
// case where retrying matters (the device was locked, or offline), and
// suppressing it would turn a self-correcting failure into a permanent one.
type MountGate struct {
	mu   sync.Mutex
	udid string
	seen time.Time
}

// MountGateTTL is how long an observed mount is trusted without re-checking.
// Short enough that a device wiped or downgraded mid-session recovers on its
// own, long enough that a retry loop stops paying for the check.
const MountGateTTL = 5 * time.Minute

// Mounted reports whether the image is known to be mounted for udid, so the
// caller can skip both the state probe and the mount itself.
func (g *MountGate) Mounted(udid string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.udid == udid && !g.seen.IsZero() && time.Since(g.seen) < MountGateTTL
}

// MarkMounted records that the image was observed mounted for udid.
func (g *MountGate) MarkMounted(udid string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.udid, g.seen = udid, time.Now()
}

// Forget drops the cached observation, forcing the next attempt to check again.
func (g *MountGate) Forget() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.udid, g.seen = "", time.Time{}
}
