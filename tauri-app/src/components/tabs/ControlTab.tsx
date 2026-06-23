import React, { useMemo, useState } from "react";
import { Activity, MapPin, Pause, Play, RefreshCw, ShieldCheck, Smartphone, Square, Zap } from "lucide-react";
import { useWebSocket } from "../../context/websocket";
import { parseCoordinate } from "../../lib/parse";

interface ControlTabProps {
  showToast: (message: string) => void;
}

const formatCoords = (lat?: number, lon?: number, precision = 5) => {
  if (lat === undefined || lon === undefined) return "Aucune";
  return `${lat.toFixed(precision)}, ${lon.toFixed(precision)}`;
};

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

  const currentPos = useMemo(() => {
    if (status?.navigation?.progress) {
      return { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon };
    }
    if (status?.lastInjectedLocation) {
      return { lat: status.lastInjectedLocation.lat, lon: status.lastInjectedLocation.lon };
    }
    return { lat: 48.8566, lon: 2.3522 };
  }, [status?.lastInjectedLocation, status?.navigation?.progress]);

  const isSimRunning = status?.state === "moving" || status?.state === "paused";
  const drift = Math.round(status?.lastRealLocation?.drift ?? 0);

  const triggerTeleport = () => {
    const lat = parseCoordinate(teleportLat, -90, 90);
    const lon = parseCoordinate(teleportLon, -180, 180);
    if (lat === null || lon === null) {
      setTeleportError("Latitude -90/90 et longitude -180/180 attendues.");
      return;
    }
    if (!canSend) {
      setTeleportError("Moteur hors ligne: injection impossible.");
      return;
    }
    setTeleportError("");
    setLocation(lat, lon, "Téléportation manuelle");
    showToast("Position envoyée au moteur.");
  };

  const startPatrol = () => {
    updatePatrolZone({
      type: patrolType,
      center: currentPos,
      radius: parseFloat(patrolRadius) || 200,
      active: true,
    });
  };

  const stopPatrol = () => {
    updatePatrolZone({
      type: patrolType,
      center: currentPos,
      radius: parseFloat(patrolRadius) || 200,
      active: false,
    });
  };

  return (
    <div className="control-screen">
      <div className="control-actionbar">
        <button className="btn btn-secondary" onClick={relance} disabled={!canSend}>
          <RefreshCw size={14} /> Relancer
        </button>
        <button className="btn btn-danger" onClick={clearLocation} disabled={!canSend}>
          <Square size={14} /> Arrêter GPS
        </button>
      </div>

      {(lastError || !canSend) && (
        <div className="inline-alert">
          {lastError || "Démarrez le moteur GPS-Mock pour activer les commandes."}
        </div>
      )}

      <section className="command-panel primary-command">
        <div className="command-panel-header">
          <div>
            <span className="section-kicker">Commande</span>
            <h2>
              <MapPin size={17} /> Injection GPS
            </h2>
          </div>
          <span className={`state-pill ${canSend ? "ok" : "offline"}`}>{canSend ? "prêt" : "offline"}</span>
        </div>

        <div className="coordinate-row">
          <label>
            <span>Latitude</span>
            <input type="text" placeholder="48.8566" value={teleportLat} onChange={(e) => setTeleportLat(e.target.value)} />
          </label>
          <label>
            <span>Longitude</span>
            <input type="text" placeholder="2.3522" value={teleportLon} onChange={(e) => setTeleportLon(e.target.value)} />
          </label>
        </div>
        {teleportError && <div className="field-error">{teleportError}</div>}
        <button className="btn btn-primary-wide" onClick={triggerTeleport} disabled={!canSend}>
          <Zap size={15} /> Téléporter
        </button>
      </section>

      <section className="metric-grid dense-metrics" aria-label="État système">
        <div className="metric-tile">
          <span>Moteur</span>
          <strong className={canSend ? "ok" : "warn"}>
            {connectionStatus === "connected" ? "Connecté" : connectionStatus === "reconnecting" ? "Reconnexion" : "Hors ligne"}
          </strong>
          <small>{connectionUrl}</small>
        </div>
        <div className="metric-tile">
          <span>Tunnel</span>
          <strong className={status?.tunnelActive ? "ok" : ""}>{status?.tunnelActive ? "Actif" : "Inactif"}</strong>
          <small>{status?.connectionType || "UNKNOWN"}</small>
        </div>
        <div className="metric-tile">
          <span>Dernière injection</span>
          <strong>{formatCoords(status?.lastInjectedLocation?.lat, status?.lastInjectedLocation?.lon, 4)}</strong>
          <small>{status?.lastInjectedLocation?.name || "position simulée"}</small>
        </div>
        <div className="metric-tile">
          <span>Drift</span>
          <strong className={drift > 100 ? "warn" : "ok"}>{status?.lastRealLocation ? `${drift} m` : "n/a"}</strong>
          <small>bouclier anti-dérive</small>
        </div>
      </section>

      {isSimRunning && (
        <section className="command-panel compact-command">
          <div className="command-panel-header">
            <div>
              <span className="section-kicker">Simulation</span>
              <h2>
                <Activity size={17} /> {status?.state === "paused" ? "En pause" : "En mouvement"}
              </h2>
            </div>
          </div>
          <div className="control-actionbar">
            {status?.state === "paused" ? (
              <button className="btn btn-success" onClick={resumeRoute} disabled={!canSend}>
                <Play size={14} /> Reprendre
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={pauseRoute} disabled={!canSend}>
                <Pause size={14} /> Pause
              </button>
            )}
            <button className="btn btn-danger" onClick={stopRoute} disabled={!canSend}>
              <Square size={14} /> Stop
            </button>
          </div>
        </section>
      )}

      {telemetry && (
        <section className="metric-grid dense-metrics" aria-label="Télémétrie">
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
        </section>
      )}

      <section className="command-panel compact-command">
        <div className="command-panel-header">
          <div>
            <span className="section-kicker">Device</span>
            <h2>
              <Smartphone size={17} /> Périphérique
            </h2>
          </div>
          <span className="state-pill">{status?.deviceInfo ? "détecté" : "aucun"}</span>
        </div>
        {status?.deviceInfo ? (
          <div className="field-row-list">
            <div><span>Nom</span><strong>{status.deviceInfo.name}</strong></div>
            <div><span>Driver</span><strong>{status.deviceInfo.driver}</strong></div>
            <div><span>Transport</span><strong>{status.connectionType}</strong></div>
          </div>
        ) : (
          <div className="empty-state compact">Aucun appareil connecté.</div>
        )}
      </section>

      <section className="command-panel compact-command">
        <div className="command-panel-header">
          <div>
            <span className="section-kicker">Zone</span>
            <h2>
              <ShieldCheck size={17} /> Patrouille
            </h2>
          </div>
          <span className={`state-pill ${status?.patrolZone?.active ? "ok" : ""}`}>
            {status?.patrolZone?.active ? "active" : "inactive"}
          </span>
        </div>
        <div className="coordinate-row">
          <label>
            <span>Type</span>
            <select value={patrolType} onChange={(e) => setPatrolType(e.target.value as "circle" | "rectangle")}>
              <option value="circle">Cercle</option>
              <option value="rectangle">Rectangle</option>
            </select>
          </label>
          <label>
            <span>Rayon</span>
            <input type="number" value={patrolRadius} onChange={(e) => setPatrolRadius(e.target.value)} disabled={patrolType !== "circle"} />
          </label>
        </div>
        {status?.patrolZone?.active ? (
          <button className="btn btn-danger" disabled={!canSend} onClick={stopPatrol}>
            <Square size={14} /> Arrêter patrouille
          </button>
        ) : (
          <button className="btn btn-success" disabled={!canSend} onClick={startPatrol}>
            <Play size={14} /> Lancer patrouille
          </button>
        )}
      </section>
    </div>
  );
};
