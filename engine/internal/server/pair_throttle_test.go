package server

import (
	"net/http"
	"testing"
	"time"
)

// The brute-force scenario: a LAN attacker guessing 6-digit codes must be cut
// off after the burst instead of being allowed to keep trying at line rate.
func TestPairBruteForceIsThrottled(t *testing.T) {
	h, _ := newAuthHandler(t)

	for i := range pairBurst {
		rec := do(h, "POST", "/api/pair", remoteAddr, `{"code":"000000"}`)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d = %d, want 401 (wrong code, still within burst)", i+1, rec.Code)
		}
	}

	rec := do(h, "POST", "/api/pair", remoteAddr, `{"code":"000000"}`)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt %d = %d, want 429", pairBurst+1, rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 response is missing a Retry-After header")
	}
}

// A successful pairing refunds its attempt, so honest re-pairing never walks
// into the anti-brute-force budget.
func TestSuccessfulPairingDoesNotConsumeBudget(t *testing.T) {
	h, store := newAuthHandler(t)

	for range pairBurst * 3 {
		code, err := store.CurrentCode(time.Now())
		if err != nil {
			t.Fatalf("CurrentCode: %v", err)
		}
		rec := do(h, "POST", "/api/pair", remoteAddr, `{"code":"`+code+`","label":"iPhone"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("successful pairing = %d, want 200", rec.Code)
		}
	}
}

// Budget is per source IP: one throttled attacker must not lock out everyone
// else on the network.
func TestThrottleIsPerIP(t *testing.T) {
	h, _ := newAuthHandler(t)

	for range pairBurst + 1 {
		do(h, "POST", "/api/pair", remoteAddr, `{"code":"000000"}`)
	}
	if rec := do(h, "POST", "/api/pair", "192.168.1.99:5555", `{"code":"000000"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("other IP = %d, want 401 (its own budget)", rec.Code)
	}
}

func TestThrottleRefillsOverTime(t *testing.T) {
	tr := newPairThrottle()
	now := time.Now()
	tr.now = func() time.Time { return now }

	for i := range pairBurst {
		if !tr.allow("10.0.0.1") {
			t.Fatalf("attempt %d denied while still within burst", i+1)
		}
	}
	if tr.allow("10.0.0.1") {
		t.Fatal("burst was not enforced")
	}

	now = now.Add(pairRefillInterval)
	if !tr.allow("10.0.0.1") {
		t.Fatal("one attempt should have refilled after pairRefillInterval")
	}
	if tr.allow("10.0.0.1") {
		t.Fatal("only one attempt should have refilled")
	}
}

// The per-IP map must not grow without bound under a spoofed-source flood.
func TestThrottlePrunesIdleEntries(t *testing.T) {
	tr := newPairThrottle()
	now := time.Now()
	tr.now = func() time.Time { return now }

	tr.allow("10.0.0.1")
	tr.allow("10.0.0.2")
	if len(tr.buckets) != 2 {
		t.Fatalf("buckets = %d, want 2", len(tr.buckets))
	}

	now = now.Add(pairEntryTTL + time.Minute)
	tr.allow("10.0.0.3") // any attempt sweeps the map
	if len(tr.buckets) != 1 {
		t.Fatalf("buckets after prune = %d, want 1 (only the fresh one)", len(tr.buckets))
	}
}
