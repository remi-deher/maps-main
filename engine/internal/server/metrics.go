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
