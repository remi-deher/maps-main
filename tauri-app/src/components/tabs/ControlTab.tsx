import React, { useState } from "react";
import { Activity, Sliders, Smartphone, MapPin, Play, Pause, Square, RefreshCw } from "lucide-react";
import { useWebSocket } from "../../context/websocket";
import { parseCoordinate } from "../../lib/parse";

interface ControlTabProps {
  showToast: (message: string) => void;
}

/// Control & telemetry tab (system state, running simulation, telemetry, device,
/// GPS injection, zone patrol), extracted from the Sidebar god-component.
export const ControlTab: React.FC<ControlTabProps> = ({ showToast }) => {
  const {
    connectionStatus,
    connectionUrl,
    canSend,
    status,
    telemetry,
    lastError,
    setLocation,
    clearLocation,
    stopRoute,
    pauseRoute,
    resumeRoute,
    relance,
    updatePatrolZone,
  } = useWebSocket();

  const [teleportLat, setTeleportLat] = useState("");
  const [teleportLon, setTeleportLon] = useState("");
  const [teleportError, setTeleportError] = useState("");
  const [patrolType, setPatrolType] = useState<"circle" | "rectangle">("circle");
  const [patrolRadius, setPatrolRadius] = useState("200");

  const currentPos = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : (status?.lastInjectedLocation ? { lat: status.lastInjectedLocation.lat, lon: status.lastInjectedLocation.lon } : { lat: 48.8566, lon: 2.3522 });

  const triggerTeleport = () => {
    const lat = parseCoordinate(teleportLat, -90, 90);
    const lon = parseCoordinate(teleportLon, -180, 180);
    if (lat === null || lon === null) {
      setTeleportError("Saisissez une latitude entre -90 et 90 et une longitude entre -180 et 180.");
      return;
    }
    if (!canSend) {
      setTeleportError("Moteur hors ligne: impossible d'injecter une position.");
      return;
    }
    setTeleportError("");
    setLocation(lat, lon, "Téléportation manuelle");
    showToast("Position envoyée au moteur.");
  };

  return (
    <>
      <div className="ui-card system-card">
        <h3 className="ui-card-title">
          <Activity size={16} /> État système
        </h3>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Moteur</span>
            <span className={`info-value ${canSend ? "green" : "warning"}`}>
              {connectionStatus === "connected" ? "Connecté" : connectionStatus === "reconnecting" ? "Reconnexion" : "Hors ligne"}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">Endpoint</span>
            <span className="info-value compact">{connectionUrl}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Tunnel</span>
            <span className={`info-value ${status?.tunnelActive ? "green" : ""}`}>
              {status?.tunnelActive ? "Actif" : "Inactif"}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">Dernière injection</span>
            <span className="info-value compact">
              {status?.lastInjectedLocation
                ? `${status.lastInjectedLocation.lat.toFixed(4)}, ${status.lastInjectedLocation.lon.toFixed(4)}`
                : "Aucune"}
            </span>
          </div>
          {status?.lastRealLocation && (
            <div className="info-item">
              <span className="info-label">Dérive (bouclier anti-dérive)</span>
              <span className={`info-value ${(status.lastRealLocation.drift || 0) > 100 ? "warning" : "green"}`}>
                {Math.round(status.lastRealLocation.drift || 0)} m
              </span>
            </div>
          )}
        </div>
        {(lastError || !canSend) && (
          <div className="inline-alert">
            {lastError || "Démarrez le moteur GPS-Mock pour activer les commandes."}
          </div>
        )}
      </div>

      {(status?.state === "moving" || status?.state === "paused") && (
        <div className="ui-card">
          <h3 className="ui-card-title">
            <Activity size={16} /> Simulation en cours ({status.state === "paused" ? "en pause" : "en mouvement"})
          </h3>
          <div className="btn-group" style={{ marginTop: "8px" }}>
            {status.state === "paused" ? (
              <button className="btn btn-success" onClick={resumeRoute} disabled={!canSend}>
                <Play size={14} /> Reprendre
              </button>
            ) : (
              <button className="btn" onClick={pauseRoute} disabled={!canSend}>
                <Pause size={14} /> Pause
              </button>
            )}
            <button className="btn btn-danger" onClick={stopRoute} disabled={!canSend}>
              <Square size={14} /> Stop
            </button>
          </div>
        </div>
      )}

      {telemetry && (
        <div className="ui-card">
          <h3 className="ui-card-title">
            <Sliders size={16} /> Télémétrie
          </h3>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Latence</span>
              <span className="info-value blue">{telemetry.latency} ms</span>
            </div>
            <div className="info-item">
              <span className="info-label">Pertes paquets</span>
              <span className="info-value">{telemetry.packetLoss}%</span>
            </div>
            <div className="info-item">
              <span className="info-label">Disponibilité</span>
              <span className="info-value">{telemetry.uptime}s</span>
            </div>
            <div className="info-item">
              <span className="info-label">Débit</span>
              <span className="info-value green">{(telemetry.throughput / 1024).toFixed(1)} KB/s</span>
            </div>
          </div>
        </div>
      )}

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Smartphone size={16} /> Périphérique
        </h3>
        {status?.deviceInfo ? (
          <div className="info-grid">
            <div className="info-item" style={{ gridColumn: "span 2" }}>
              <span className="info-label">Nom</span>
              <span className="info-value">{status.deviceInfo.name}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Driver actif</span>
              <span className="info-value blue">{status.deviceInfo.driver}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Transport</span>
              <span className="info-value green">{status.connectionType}</span>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "0.85rem", color: "#64748b", textAlign: "center" }}>
            Aucun appareil connecté.
          </div>
        )}
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <MapPin size={16} /> Injection GPS
        </h3>
        <div className="form-group">
          <label className="form-label">Coordonnées (Lat, Lon)</label>
          <div className="search-group">
            <input type="text" placeholder="Latitude" value={teleportLat} onChange={(e) => setTeleportLat(e.target.value)} />
            <input type="text" placeholder="Longitude" value={teleportLon} onChange={(e) => setTeleportLon(e.target.value)} />
          </div>
          {teleportError && <div className="field-error">{teleportError}</div>}
          <button className="btn" onClick={triggerTeleport} disabled={!canSend}>
            Téléporter
          </button>
        </div>

        <div className="btn-group" style={{ marginTop: "8px" }}>
          <button className="btn btn-secondary" onClick={relance} disabled={!canSend}>
            <RefreshCw size={14} /> Relancer
          </button>
          <button className="btn btn-danger" onClick={clearLocation} disabled={!canSend}>
            <Square size={14} /> Arrêter
          </button>
        </div>
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Activity size={16} /> Patrouille de zone
        </h3>
        <div className="form-group">
          <label className="form-label">Type de zone</label>
          <select value={patrolType} onChange={(e) => setPatrolType(e.target.value as any)}>
            <option value="circle">Cercle</option>
            <option value="rectangle">Rectangle</option>
          </select>
        </div>
        {patrolType === "circle" && (
          <div className="form-group">
            <label className="form-label">Rayon (mètres)</label>
            <input type="number" value={patrolRadius} onChange={(e) => setPatrolRadius(e.target.value)} />
          </div>
        )}
        <div className="btn-group" style={{ marginTop: "8px" }}>
          {status?.patrolZone?.active ? (
            <button
              className="btn btn-danger"
              disabled={!canSend}
              onClick={() =>
                updatePatrolZone({
                  type: patrolType,
                  center: currentPos,
                  radius: parseFloat(patrolRadius) || 200,
                  active: false,
                })
              }
            >
              <Square size={14} /> Arrêter Patrouille
            </button>
          ) : (
            <button
              className="btn btn-success"
              disabled={!canSend}
              onClick={() =>
                updatePatrolZone({
                  type: patrolType,
                  center: currentPos,
                  radius: parseFloat(patrolRadius) || 200,
                  active: true,
                })
              }
            >
              <Play size={14} /> Lancer Patrouille
            </button>
          )}
        </div>
      </div>
    </>
  );
};
