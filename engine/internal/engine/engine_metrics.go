package engine

import (
	"sync/atomic"
	"time"
)

// Counters for the things that actually go wrong with a tunnel.
//
// api.TunnelHealth already carries the live state a client needs to render
// (uptime anchor, last RTT, consecutive failures, searching). What it cannot
// answer is the question you ask after the fact: did this tunnel flap all
// afternoon, or has it been up since boot? Was that one failed injection, or
// three hundred? Those are monotonic counters, exported at /metrics, and they
// are the difference between "the user says it sometimes stops working" and a
// graph showing when.

// EngineMetrics is a point-in-time snapshot of the engine's counters. Plain
// values, so the caller can format them without holding any lock.
type EngineMetrics struct {
	InjectionsOK        uint64
	InjectionsFailed    uint64
	TunnelStarts        uint64
	TunnelStartFailures uint64
	TunnelReresolves    uint64
	TunnelRestarts      uint64
	// LastStartSeconds is how long the last successful StartTunnel took, end to
	// end — developer-image mount and both tunnel attempts included. A boot that
	// suddenly takes 90s instead of 5s is the symptom nobody reports but
	// everybody feels.
	LastStartSeconds float64
}

type engineMetrics struct {
	injectionsOK        atomic.Uint64
	injectionsFailed    atomic.Uint64
	tunnelStarts        atomic.Uint64
	tunnelStartFailures atomic.Uint64
	tunnelReresolves    atomic.Uint64
	tunnelRestarts      atomic.Uint64
	lastStartNanos      atomic.Int64
}

func (m *engineMetrics) snapshot() EngineMetrics {
	return EngineMetrics{
		InjectionsOK:        m.injectionsOK.Load(),
		InjectionsFailed:    m.injectionsFailed.Load(),
		TunnelStarts:        m.tunnelStarts.Load(),
		TunnelStartFailures: m.tunnelStartFailures.Load(),
		TunnelReresolves:    m.tunnelReresolves.Load(),
		TunnelRestarts:      m.tunnelRestarts.Load(),
		LastStartSeconds:    time.Duration(m.lastStartNanos.Load()).Seconds(),
	}
}

// Metrics returns the current counters. Safe to call from any goroutine.
func (e *Engine) Metrics() EngineMetrics { return e.metrics.snapshot() }
