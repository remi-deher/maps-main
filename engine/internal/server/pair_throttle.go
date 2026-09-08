package server

import (
	"sync"
	"time"
)

// POST /api/pair is the one endpoint an unauthenticated peer may call — the
// rotating 6-digit code is itself the credential. Six digits is only ~20 bits,
// and while the code rotates every 30s the search space does not: an attacker
// on the LAN who can send thousands of guesses per second expects a hit in
// minutes. The throttle below removes that: a client gets a small burst of
// attempts and then one every pairRefillInterval, which is invisible to a human
// typing a code and fatal to a brute-force.
//
// Only *failed* attempts consume budget, so a legitimate client that pairs on
// the first try is never delayed, and a successful pairing refunds the whole
// bucket.
const (
	// pairBurst is how many failures in a row are tolerated before throttling
	// kicks in — enough for a mistyped code and a code that expired mid-entry.
	pairBurst = 5
	// pairRefillInterval is how long one attempt takes to come back once the
	// burst is spent, capping a sustained attack at ~6 guesses/minute.
	pairRefillInterval = 10 * time.Second
	// pairEntryTTL is how long an idle per-IP entry is kept before being
	// pruned, bounding the map's growth under a spoofed-source flood.
	pairEntryTTL = 30 * time.Minute
)

// pairThrottle rate-limits pairing attempts per source IP.
//
// Everything is guarded by a single mutex: the buckets are touched once per
// pairing attempt (a rare, human-paced event), so there is nothing to gain from
// finer-grained locking and plenty to lose in complexity.
type pairThrottle struct {
	mu      sync.Mutex
	buckets map[string]*pairBucket
	// now is injectable so the tests can advance time without sleeping.
	now func() time.Time
}

type pairBucket struct {
	tokens   float64
	lastSeen time.Time
}

func newPairThrottle() *pairThrottle {
	return &pairThrottle{
		buckets: make(map[string]*pairBucket),
		now:     time.Now,
	}
}

// allow reports whether another pairing attempt from ip may proceed, consuming
// one token when it does. The token is given back by success (see refund), so
// the budget only ever shrinks on failures.
func (t *pairThrottle) allow(ip string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	t.pruneLocked(now)

	b, ok := t.buckets[ip]
	if !ok {
		b = &pairBucket{tokens: pairBurst}
		t.buckets[ip] = b
	} else {
		elapsed := now.Sub(b.lastSeen).Seconds()
		b.tokens += elapsed / pairRefillInterval.Seconds()
		if b.tokens > pairBurst {
			b.tokens = pairBurst
		}
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// refund returns the token allow took, called when the attempt turned out to be
// legitimate. Without it, a device that pairs, is revoked and re-pairs a few
// times would eat into a budget meant for attackers.
func (t *pairThrottle) refund(ip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if b, ok := t.buckets[ip]; ok {
		if b.tokens += 1; b.tokens > pairBurst {
			b.tokens = pairBurst
		}
	}
}

// pruneLocked drops entries untouched for pairEntryTTL. Called from allow while
// the mutex is held; the map only grows on pairing attempts, so amortising the
// sweep over them is enough and avoids a background goroutine.
func (t *pairThrottle) pruneLocked(now time.Time) {
	for ip, b := range t.buckets {
		if now.Sub(b.lastSeen) > pairEntryTTL {
			delete(t.buckets, ip)
		}
	}
}
