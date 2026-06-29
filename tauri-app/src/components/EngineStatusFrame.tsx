import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useEngine } from "../context/websocket";

/// Compact connection pill that expands on demand. Collapsed it shows just the
/// connection state (+ latency when available) so it stays glanceable without
/// permanently occupying a 220px panel; expanded it reveals the full engine,
/// tunnel and telemetry metrics.
export const EngineStatusFrame: React.FC = () => {
  const { connectionStatus, connectionUrl, canSend, status, telemetry, lastError } = useEngine();
  const [expanded, setExpanded] = useState(false);

  const label =
    connectionStatus === "connected"
      ? "Connecté"
      : connectionStatus === "reconnecting"
      ? "Reconnexion"
      : "Hors ligne";

  return (
    <div className={`engine-status-frame ${expanded ? "expanded" : ""}`}>
      <button
        className="engine-status-pill"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="État du moteur GPS-Mock"
      >
        <span className={`status-badge ${canSend ? "connected" : "disconnected"}`}>
          <span className="pulse-dot"></span>
          {label}
        </span>
        {telemetry && !expanded && <span className="engine-pill-metric">{telemetry.latency} ms</span>}
        <ChevronDown size={14} className="engine-pill-chevron" />
      </button>

      {expanded && (
        <div className="engine-status-details">
          {(lastError || !canSend) && (
            <div className="inline-alert">
              {lastError || "Démarrez le moteur GPS-Mock pour activer les commandes."}
            </div>
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
                <strong>{telemetry.latency} ms</strong>
              </div>
              <div className="metric-tile">
                <span>Paquets</span>
                <strong>{telemetry.packetLoss}%</strong>
              </div>
              <div className="metric-tile">
                <span>Uptime</span>
                <strong>{telemetry.uptime}s</strong>
              </div>
              <div className="metric-tile">
                <span>Débit</span>
                <strong className="ok">{(telemetry.throughput / 1024).toFixed(1)} KB/s</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
