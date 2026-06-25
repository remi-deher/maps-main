import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Status, LatLon } from "../context/websocket";

interface TelemetryWidgetProps {
  status: Status;
  currentPos: LatLon;
}

/// Collapsed pill showing the simulated-position status at a glance (state +
/// speed); expands on click to reveal coordinates, route progress and the
/// real-device drift — mirrors the EngineStatusFrame pattern so the map
/// doesn't carry a permanently-open detail panel.
export const TelemetryWidget: React.FC<TelemetryWidgetProps> = ({ status, currentPos }) => {
  const [expanded, setExpanded] = useState(false);

  const speed = status.navigation?.progress?.speed?.toFixed(1) || (status.state === "moving" ? "15.0" : "0.0");
  const stateLabel = status.state === "moving" ? "En mouvement" : status.state === "paused" ? "En pause" : "Arrêté";
  const stateClass = status.state === "moving" ? "moving" : status.state === "paused" ? "" : "disconnected";

  return (
    <div className={`map-telemetry-widget ${expanded ? "expanded" : ""}`}>
      <button
        className="engine-status-pill"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Position simulée"
      >
        <span className={`status-badge ${stateClass}`}>
          <span className="pulse-dot"></span>
          {stateLabel}
        </span>
        {!expanded && <span className="engine-pill-metric">{speed} km/h</span>}
        <ChevronDown size={14} className="engine-pill-chevron" />
      </button>

      {expanded && (
        <div className="widget-body">
          <div className="widget-row">
            <span className="label">Vitesse :</span>
            <span className="value">{speed} km/h</span>
          </div>
          <div className="widget-row">
            <span className="label">Coordonnées :</span>
            <span className="value coords">
              {currentPos.lat.toFixed(5)}, {currentPos.lon.toFixed(5)}
            </span>
          </div>
          {status.navigation?.status?.state === "running" && (
            <div className="widget-progress">
              <div className="progress-info">
                <span>Étape :</span>
                <span>
                  {status.navigation.status.index + 1} / {status.navigation.status.total}
                </span>
              </div>
              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${((status.navigation.status.index + 1) / status.navigation.status.total) * 100}%`,
                  }}
                ></div>
              </div>
            </div>
          )}

          {status.lastRealLocation && status.lastRealLocation.lat !== 0 && (
            <>
              <div className="widget-row" style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px", marginTop: "4px" }}>
                <span className="label" style={{ color: "#ef4444" }}>Position réelle :</span>
                <span className="value coords" style={{ color: "#fca5a5" }}>
                  {status.lastRealLocation.lat.toFixed(5)}, {status.lastRealLocation.lon.toFixed(5)}
                </span>
              </div>
              <div className="widget-row">
                <span className="label" style={{ color: "#ef4444" }}>Dérive :</span>
                <span
                  className="value"
                  style={{
                    color: status.lastRealLocation.drift && status.lastRealLocation.drift > 100 ? "#ef4444" : "#10b981",
                    fontWeight: "bold",
                  }}
                >
                  {Math.round(status.lastRealLocation.drift ?? 0)} m
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
