import React, { useState } from "react";
import { ChevronDown, RotateCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEngine } from "../context/websocket";
import { isTauri } from "../lib/runtime";

// Human-readable uptime ("1 j 2 h", "34 min", "12 s") instead of raw seconds,
// which are unreadable precisely in the long-running sessions this app targets.
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.floor(seconds)} s`;
}

// Throughput arrives already in KB/s from the server (see server.go runTelemetry);
// present it adaptively without the erroneous extra /1024 the old widget applied.
function formatThroughput(kbs: number): string {
  if (!Number.isFinite(kbs) || kbs <= 0) return "0 Ko/s";
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)} Mo/s`;
  return `${kbs.toFixed(1)} Ko/s`;
}

/// Compact connection pill that expands on demand. Collapsed it shows just the
/// connection state (+ latency when available) so it stays glanceable without
/// permanently occupying a 220px panel; expanded it reveals the full engine,
/// tunnel and telemetry metrics.
export const EngineStatusFrame: React.FC = () => {
  const { connectionStatus, connectionUrl, canSend, status, telemetry, lastError, isStale, engineStatus } =
    useEngine();
  const [expanded, setExpanded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const label =
    connectionStatus === "connected"
      ? isStale
        ? "Données obsolètes"
        : "Connecté"
      : connectionStatus === "reconnecting"
      ? "Reconnexion"
      : "Hors ligne";

  // The engine sidecar died and the supervisor isn't mid-restart — offer a
  // manual restart (Tauri desktop only; the web build has no sidecar to spawn).
  const showRestart = isTauri && engineStatus === "crashed";

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await invoke("restart_engine");
    } catch {
      // Errors surface through the engine-status event stream; nothing to do.
    } finally {
      setRestarting(false);
    }
  };

  const latencyText = telemetry && telemetry.latency > 0 ? `${telemetry.latency} ms` : "—";

  return (
    <div className={`engine-status-frame ${expanded ? "expanded" : ""} ${isStale ? "stale" : ""}`}>
      <button
        className="engine-status-pill"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="État du moteur GPS-Mock"
      >
        <span className={`status-badge ${canSend && !isStale ? "connected" : "disconnected"}`}>
          <span className="pulse-dot"></span>
          {label}
        </span>
        {telemetry && !expanded && !isStale && <span className="engine-pill-metric">{latencyText}</span>}
        <ChevronDown size={14} className="engine-pill-chevron" />
      </button>

      {expanded && (
        <div className="engine-status-details">
          {(lastError || !canSend) && (
            <div className="inline-alert">
              {lastError || "Démarrez le moteur GPS-Mock pour activer les commandes."}
            </div>
          )}

          {showRestart && (
            <button className="engine-restart-btn" onClick={handleRestart} disabled={restarting}>
              <RotateCw size={14} className={restarting ? "spin-icon" : ""} />
              {restarting ? "Redémarrage…" : "Redémarrer le moteur"}
            </button>
          )}

          <div className="metric-grid dense-metrics">
            <div className="metric-tile">
              <span>Moteur</span>
              <strong className={canSend ? "ok" : "warn"}>{canSend ? "En ligne" : "Hors ligne"}</strong>
              <small>{connectionUrl}</small>
            </div>
            <div className="metric-tile">
              <span>Tunnel</span>
              <strong className={status?.tunnelActive ? "ok" : ""}>{status?.tunnelActive ? "Actif" : "Inactif"}</strong>
              <small>{status?.connectionType || "UNKNOWN"}</small>
            </div>
          </div>

          {telemetry && (
            <div className="metric-grid dense-metrics">
              <div className="metric-tile">
                <span>Latence</span>
                <strong>{latencyText}</strong>
              </div>
              <div className="metric-tile">
                <span>Paquets</span>
                <strong>{telemetry.packetLoss}%</strong>
              </div>
              <div className="metric-tile">
                <span>Uptime</span>
                <strong>{formatUptime(telemetry.uptime)}</strong>
              </div>
              <div className="metric-tile">
                <span>Débit</span>
                <strong className="ok">{formatThroughput(telemetry.throughput)}</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
