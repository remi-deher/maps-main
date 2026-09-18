package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// handleMetrics exposes the same real measurements as runTelemetry's
// TELEMETRY broadcast, in the Prometheus text exposition format, for
// external scraping (Grafana, Alertmanager, etc.) without needing a
// WebSocket client. Hand-rolled rather than pulling in
// github.com/prometheus/client_golang: the metric set is small and static,
// so the format's few lines of text don't justify the dependency.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	var b strings.Builder

	writeGauge(&b, "gpsmock_uptime_seconds", "Seconds since the engine process started.", time.Since(s.startedAt).Seconds())
	writeGauge(&b, "gpsmock_ws_clients_connected", "Currently connected WebSocket clients.", float64(s.hub.clientCount()))

	totalBytes, totalDropped := s.hub.totals()
	writeCounter(&b, "gpsmock_ws_bytes_sent_total", "Bytes broadcast to WebSocket clients since startup.", float64(totalBytes))
	writeCounter(&b, "gpsmock_ws_clients_dropped_total", "WebSocket clients dropped for being too slow to keep up, since startup.", float64(totalDropped))

	s.metricsMu.Lock()
	if len(s.wsActions) > 0 {
		fmt.Fprintf(&b, "# HELP gpsmock_ws_actions_total Total WebSocket actions processed by action and status.\n")
		fmt.Fprintf(&b, "# TYPE gpsmock_ws_actions_total counter\n")
		for actName, statuses := range s.wsActions {
			for status, count := range statuses {
				fmt.Fprintf(&b, "gpsmock_ws_actions_total{action=%q,status=%q} %d\n", actName, status, count)
			}
		}
	}
	s.metricsMu.Unlock()

	s.writeTunnelMetrics(&b)

	if mgr := s.eng.ClusterManager(); mgr != nil {
		info := mgr.Status()
		writeGauge(&b, "gpsmock_cluster_epoch", "Current cluster master election term.", float64(info.Epoch))
		writeGaugeLabeled(&b, "gpsmock_cluster_role", "Whether this node currently holds a given cluster role (1) or not (0).", "role", info.Role)
		// Prometheus convention is base units (seconds, not "ms") in the
		// metric name; AverageLatencyMs returns milliseconds, so convert.
		writeGauge(&b, "gpsmock_cluster_peer_latency_seconds", "Mean round-trip time to reachable cluster peers, in seconds.", mgr.AverageLatencyMs()/1000)
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(b.String()))
}

// writeTunnelMetrics exposes the tunnel's live state and the counters behind it.
// Until now /metrics said plenty about the HTTP and cluster layers and nothing
// about the one thing this engine exists to do — so "it sometimes stops
// injecting" could only ever be answered by reading logs after the fact.
func (s *Server) writeTunnelMetrics(b *strings.Builder) {
	st := s.eng.Status()

	writeGauge(b, "gpsmock_tunnel_up", "Whether an RSD tunnel is currently established (1) or not (0).", boolGauge(st.TunnelActive))
	if st.TunnelActive && st.ConnectionType != "" {
		writeGaugeLabeled(b, "gpsmock_tunnel_connection_type", "The transport the active tunnel was classified as.", "type", string(st.ConnectionType))
	}

	if th := st.TunnelHealth; th != nil {
		if th.EstablishedAt > 0 {
			age := time.Since(time.UnixMilli(th.EstablishedAt)).Seconds()
			writeGauge(b, "gpsmock_tunnel_uptime_seconds", "Seconds since the current tunnel was established.", age)
		}
		// Prometheus convention is base units: LastCheckRTTms is milliseconds.
		writeGauge(b, "gpsmock_tunnel_health_rtt_seconds", "Round-trip time of the last successful tunnel health probe, in seconds.", float64(th.LastCheckRTTms)/1000)
		writeGauge(b, "gpsmock_tunnel_inject_failures_consecutive", "Consecutive failed position injections. A tunnel can pass its health probe while every injection fails.", float64(th.ConsecutiveInjectFailures))
		writeGauge(b, "gpsmock_tunnel_searching", "Whether the tunnel daemon is currently hunting for the device across transports (1) or not (0).", boolGauge(th.Searching))
	}

	m := s.eng.Metrics()
	writeCounter(b, "gpsmock_injections_total", "Position injections that succeeded, since startup.", float64(m.InjectionsOK))
	writeCounter(b, "gpsmock_injection_failures_total", "Position injections that failed, since startup.", float64(m.InjectionsFailed))
	writeCounter(b, "gpsmock_tunnel_starts_total", "Tunnels successfully established, since startup.", float64(m.TunnelStarts))
	writeCounter(b, "gpsmock_tunnel_start_failures_total", "Tunnel start attempts that failed, since startup.", float64(m.TunnelStartFailures))
	writeCounter(b, "gpsmock_tunnel_reresolves_total", "Times the active endpoint was re-resolved because the device moved, since startup.", float64(m.TunnelReresolves))
	writeCounter(b, "gpsmock_tunnel_restarts_total", "Times the watchdog restarted a dead tunnel daemon, since startup.", float64(m.TunnelRestarts))
	writeGauge(b, "gpsmock_tunnel_last_start_seconds", "How long the last successful tunnel start took, developer-image mount included.", m.LastStartSeconds)
}

func boolGauge(v bool) float64 {
	if v {
		return 1
	}
	return 0
}

func writeGauge(b *strings.Builder, name, help string, value float64) {
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s gauge\n%s %v\n", name, help, name, name, value)
}

func writeCounter(b *strings.Builder, name, help string, value float64) {
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s counter\n%s %v\n", name, help, name, name, value)
}

// writeGaugeLabeled emits a single labeled series set to 1 for the given
// activeValue and 0 for nothing else — the standard Prometheus pattern for
// exposing a small enum (here, the cluster role) as a gauge.
func writeGaugeLabeled(b *strings.Builder, name, help, label, activeValue string) {
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s gauge\n%s{%s=%q} 1\n", name, help, name, name, label, activeValue)
}

// ─── per-action WS counters, fed by dispatch and exposed by handleMetrics ───

func (s *Server) incrementActionMetric(action, status string) {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	if s.wsActions[action] == nil {
		s.wsActions[action] = make(map[string]int64)
	}
	s.wsActions[action][status]++
}

func (s *Server) trackAction(action string, err error) {
	status := "success"
	if err != nil {
		status = statusError(err)
	}
	s.incrementActionMetric(action, status)
}

func statusError(err error) string {
	return "error"
}
