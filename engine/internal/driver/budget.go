package driver

import "time"

// How long a caller must allow StartTunnel before giving up on it.
//
// This exists because getting it wrong silently disabled the no-admin fallback.
// StartTunnel tries a kernel-TUN tunnel first and, only if that fails, retries
// in userspace — the path that makes the app work without administrator rights.
// Callers used to pass the *per-attempt* timeout as their own context deadline,
// so the first attempt consumed the entire budget and StartTunnel's `ctx.Err()
// != nil` guard returned before the fallback could run. On a machine without
// admin rights the tunnel then only ever came up via the health monitor's retry
// loop, half a minute later, because that loop happens to pass a context with
// no deadline at all.

const (
	// prepBudget covers the bounded work StartTunnel does before it can begin
	// polling for an RSD address: mounting the Developer Disk Image (up to 60s
	// on go-ios, 30s on pmd3) and clearing a stale tunnel agent (up to 15s).
	prepBudget = 75 * time.Second
	// startAttempts is how many tunnel modes one StartTunnel call may try:
	// kernel-TUN, then the userspace fallback.
	startAttempts = 2
)

// StartBudget returns the context deadline a StartTunnel call needs, given the
// per-attempt tunnel timeout the driver was configured with. Pass zero to get
// the budget for a driver left on its own default.
func StartBudget(perAttempt time.Duration) time.Duration {
	if perAttempt <= 0 {
		perAttempt = time.Minute
	}
	return prepBudget + startAttempts*perAttempt
}
