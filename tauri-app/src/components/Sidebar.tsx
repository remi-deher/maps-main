import React, { useState } from "react";
import {
  Activity,
  Star,
  Settings,
  MapPin,
  Trash,
  Plus,
  Play,
  Pause,
  Square,
  RefreshCw,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Route,
  Smartphone,
  Save,
  QrCode
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWebSocket } from "../context/websocket";

const parseCoordinate = (value: string, min: number, max: number) => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export const Sidebar: React.FC = () => {
  const {
    isConnected,
    connectionStatus,
    connectionUrl,
    enginePort,
    engineStatus,
    setEnginePort,
    mdnsInterface,
    setMdnsInterface,
    networkInterfaces,
    lastError,
    canSend,
    status,
    telemetry,
    deviceDetails,
    getDeviceInfo,
    setLocation,
    clearLocation,
    playSequence,
    playCustomGpx,
    stopRoute,
    pauseRoute,
    resumeRoute,
    relance,
    saveSettings,
    addFavorite,
    removeFavorite,
    updatePatrolZone,
    sendMessage,
  } = useWebSocket();

  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"control" | "favs" | "route" | "settings">("control");
  const [toast, setToast] = useState<string | null>(null);
  const [teleportError, setTeleportError] = useState("");
  const [legError, setLegError] = useState("");
  const [gpxError, setGpxError] = useState("");

  // Teleport input state
  const [teleportLat, setTeleportLat] = useState("");
  const [teleportLon, setTeleportLon] = useState("");

  // Route sequence builder state
  const [sequenceLegs, setSequenceLegs] = useState<any[]>([]);
  const [looping, setLooping] = useState(false);
  const [newLegType, setNewLegType] = useState<"drive" | "walk" | "flight" | "wait">("drive");
  const [newLegStartLat, setNewLegStartLat] = useState("");
  const [newLegStartLon, setNewLegStartLon] = useState("");
  const [newLegEndLat, setNewLegEndLat] = useState("");
  const [newLegEndLon, setNewLegEndLon] = useState("");
  const [newLegSpeed, setNewLegSpeed] = useState("15");

  // Engine sidecar port (Tauri-managed, separate from the moteur's own
  // companionPort setting below which only annotates the RSD endpoint).
  const [enginePortInput, setEnginePortInput] = useState(String(enginePort));
  const [enginePortError, setEnginePortError] = useState("");

  const [showQrCode, setShowQrCode] = useState(false);
  // Pick the interface the user restricted mDNS to, if any; otherwise the
  // first detected LAN interface — "localhost" would be useless in the QR
  // code since it's scanned by a *different* device (the iPhone).
  const qrPairingHost = networkInterfaces.find((iface) => iface.name === mdnsInterface)?.ip
    ?? networkInterfaces[0]?.ip
    ?? null;
  const qrPairingAddress = qrPairingHost ? `${qrPairingHost}:${enginePort}` : null;

  const handleApplyEnginePort = async () => {
    const parsed = parseCoordinate(enginePortInput, 1, 65535);
    if (parsed === null) {
      setEnginePortError("Port invalide (1-65535).");
      return;
    }
    setEnginePortError("");
    await setEnginePort(parsed);
    showToast(`Moteur redémarré sur le port ${parsed}.`);
  };

  // Config settings form state
  const [companionPort, setCompanionPort] = useState("8080");
  const [preferredDriver, setPreferredDriver] = useState("go-ios");
  const [preferredTransport, setPreferredTransport] = useState("auto");
  const [isEveilMode, setIsEveilMode] = useState(true);
  const [eveilInterval, setEveilInterval] = useState("15");
  const [jitterEnabled, setJitterEnabled] = useState(true);

  // Routing + cluster tuning (formerly env-only, now web-managed)
  const [osrmBaseUrl, setOsrmBaseUrl] = useState("");
  const [clusterHeartbeat, setClusterHeartbeat] = useState("10");
  const [clusterMasterDead, setClusterMasterDead] = useState("30");
  const [clusterPeerTimeout, setClusterPeerTimeout] = useState("3");

  // GPX Upload state
  const [gpxContent, setGpxContent] = useState("");
  const [gpxFileName, setGpxFileName] = useState("");
  const [gpxSpeed, setGpxSpeed] = useState("25");

  // Patrol state
  const [patrolType, setPatrolType] = useState<"circle" | "rectangle">("circle");
  const [patrolRadius, setPatrolRadius] = useState("200");

  // Map Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPoints, setDrawnPoints] = useState<any[]>([]);
  const [drawnPointsCount, setDrawnPointsCount] = useState(0);
  const [drawSpeed, setDrawSpeed] = useState("15");
  const [drawLoop, setDrawLoop] = useState(false);
  const [drawProfile, setDrawProfile] = useState<"driving" | "walking">("driving");

  // Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const importFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportFavorites = () => {
    const payload = {
      favorites: status?.favorites || [],
      recentHistory: status?.recentHistory || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gps-mock-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Favoris exportés.");
  };

  const handleImportFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const favorites = Array.isArray(parsed.favorites) ? parsed.favorites : Array.isArray(parsed) ? parsed : [];
        if (favorites.length === 0) {
          showToast("Aucun favori trouvé dans ce fichier.");
          return;
        }
        favorites.forEach((fav: any) => {
          if (typeof fav.lat === "number" && typeof fav.lon === "number") {
            addFavorite(fav.lat, fav.lon, fav.name || "Favori importé");
          }
        });
        showToast(`${favorites.length} favori(s) importé(s).`);
      } catch {
        showToast("Fichier invalide.");
      }
    };
    reader.readAsText(file);
  };

  const currentPos = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : (status?.lastInjectedLocation ? { lat: status.lastInjectedLocation.lat, lon: status.lastInjectedLocation.lon } : { lat: 48.8566, lon: 2.3522 });


  React.useEffect(() => {
    const handlePointsUpdated = (e: Event) => {
      const points = (e as CustomEvent).detail;
      setDrawnPoints(points);
      setDrawnPointsCount(points.length);
    };

    const handleModeDisabled = () => {
      setIsDrawing(false);
    };

    window.addEventListener("draw-points-updated", handlePointsUpdated);
    window.addEventListener("draw-mode-disabled", handleModeDisabled);

    return () => {
      window.removeEventListener("draw-points-updated", handlePointsUpdated);
      window.removeEventListener("draw-mode-disabled", handleModeDisabled);
    };
  }, []);

  // Prefill the routing/cluster fields with the engine's live values whenever a
  // fresh status arrives, so the form shows what's actually running rather than
  // hard-coded placeholders.
  React.useEffect(() => {
    if (!status) return;
    if (status.osrmBaseUrl !== undefined) setOsrmBaseUrl(status.osrmBaseUrl);
    if (status.clusterHeartbeatSeconds) setClusterHeartbeat(String(status.clusterHeartbeatSeconds));
    if (status.clusterMasterDeadSeconds) setClusterMasterDead(String(status.clusterMasterDeadSeconds));
    if (status.clusterPeerTimeoutSeconds) setClusterPeerTimeout(String(status.clusterPeerTimeoutSeconds));
  }, [status?.osrmBaseUrl, status?.clusterHeartbeatSeconds, status?.clusterMasterDeadSeconds, status?.clusterPeerTimeoutSeconds]);

  const toggleDrawMode = () => {
    const newMode = !isDrawing;
    setIsDrawing(newMode);
    window.dispatchEvent(new CustomEvent("draw-mode-toggle", { detail: newMode }));
  };

  const clearDrawnPath = () => {
    window.dispatchEvent(new CustomEvent("draw-path-clear"));
  };

  const playDrawnPath = () => {
    window.dispatchEvent(
      new CustomEvent("draw-path-play", {
        detail: {
          speed: parseFloat(drawSpeed) || 15,
          looping: drawLoop,
          profile: drawProfile,
        },
      })
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".gpx")) {
      setGpxError("");
      setGpxFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setGpxContent(text);
      };
      reader.readAsText(file);
    } else {
      setGpxError("Déposez un fichier GPX valide.");
    }
  };

  const exportDrawnGpx = () => {
    if (drawnPoints.length === 0) return;
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="GPS-Mock v3" xmlns="http://www.topografix.com/GPX/1/1">\n';
    gpx += '  <trk>\n';
    gpx += '    <name>Drawn Path</name>\n';
    gpx += '    <trkseg>\n';
    drawnPoints.forEach((p) => {
      gpx += `      <trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>\n`;
    });
    gpx += '    </trkseg>\n';
    gpx += '  </trk>\n';
    gpx += '</gpx>';

    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gpsmock_route.gpx";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleGpxFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setGpxError("");
      setGpxFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setGpxContent(text);
      };
      reader.readAsText(file);
    }
  };

  const handlePlayGpx = () => {
    if (!canSend) {
      showToast("Moteur hors ligne: impossible de lancer le GPX.");
      return;
    }
    if (gpxContent) {
      playCustomGpx(gpxContent, parseFloat(gpxSpeed.replace(",", ".")) || 25);
      showToast("Simulation GPX envoyée au moteur.");
    }
  };

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

  const handleAddLeg = () => {
    const startLat = parseCoordinate(newLegStartLat, -90, 90);
    const startLon = parseCoordinate(newLegStartLon, -180, 180);
    const endLat = parseCoordinate(newLegEndLat, -90, 90);
    const endLon = parseCoordinate(newLegEndLon, -180, 180);
    const speed = Number(newLegSpeed.trim().replace(",", "."));

    if (endLat === null || endLon === null) {
      setLegError("Destination invalide: latitude -90 à 90, longitude -180 à 180.");
      return;
    }
    setLegError("");

    const newLeg = {
      type: newLegType,
      start: startLat === null || startLon === null ? null : { lat: startLat, lon: startLon },
      end: { lat: endLat, lon: endLon },
      speed: Number.isFinite(speed) && speed > 0 ? speed : 15,
      startTime: Date.now(),
      endTime: Date.now() + 60000 // Placeholder 1 minute
    };

    setSequenceLegs([...sequenceLegs, newLeg]);
    // Set next leg start to this leg's end
    setNewLegStartLat(newLegEndLat);
    setNewLegStartLon(newLegEndLon);
    setNewLegEndLat("");
    setNewLegEndLon("");
  };

  const handlePlaySequence = () => {
    if (sequenceLegs.length === 0) return;
    if (!canSend) {
      showToast("Moteur hors ligne: impossible de lancer la séquence.");
      return;
    }
    // Map legs, filling missing starts with previous ends
    const preparedLegs = sequenceLegs.map((leg, index) => {
      if (!leg.start) {
        const prevLeg = sequenceLegs[index - 1];
        leg.start = prevLeg ? prevLeg.end : { lat: 48.8566, lon: 2.3522 };
      }
      return leg;
    });

    playSequence(preparedLegs, looping);
    showToast("Séquence envoyée au moteur.");
  };

  const handleSaveSettings = () => {
    if (!canSend) {
      showToast("Moteur hors ligne: réglages non envoyés.");
      return;
    }
    saveSettings({
      companionPort: parseInt(companionPort),
      preferredDriver: preferredDriver as any,
      isEveilMode,
      eveilInterval: parseInt(eveilInterval),
      jitterEnabled,
      osrmBaseUrl: osrmBaseUrl.trim(),
      clusterHeartbeatSeconds: parseInt(clusterHeartbeat) || 0,
      clusterMasterDeadSeconds: parseInt(clusterMasterDead) || 0,
      clusterPeerTimeoutSeconds: parseInt(clusterPeerTimeout) || 0,
    } as any);
    showToast("Réglages envoyés au moteur.");
  };

  return (
    <>
      <button className="sidebar-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      <div className={`sidebar ${isOpen ? "" : "collapsed"}`}>
        <div className="sidebar-header">
          <div className="brand">
            <Smartphone size={22} className="text-indigo-400" />
            <h1>GPS-Mock v3</h1>
          </div>
          <div className={`status-badge ${isConnected ? "connected" : "disconnected"}`}>
            <span className="pulse-dot"></span>
            {isConnected ? (status?.state || "connecté") : "hors ligne"}
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="tabs-nav">
          <button
            className={`tab-btn ${activeTab === "control" ? "active" : ""}`}
            onClick={() => setActiveTab("control")}
          >
            <Activity size={18} />
            <span>Contrôle</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "favs" ? "active" : ""}`}
            onClick={() => setActiveTab("favs")}
          >
            <Star size={18} />
            <span>Favoris</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "route" ? "active" : ""}`}
            onClick={() => setActiveTab("route")}
          >
            <Route size={18} />
            <span>Séquences</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={18} />
            <span>Réglages</span>
          </button>
        </div>

        <div className="sidebar-content">
          {/* TAB 1: CONTROL & TELEMETRY */}
          {activeTab === "control" && (
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

              {/* Telemetry info */}
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

              {/* Device Status */}
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

              {/* Fast Actions */}
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <MapPin size={16} /> Injection GPS
                </h3>
                <div className="form-group">
                  <label className="form-label">Coordonnées (Lat, Lon)</label>
                  <div className="search-group">
                    <input
                      type="text"
                      placeholder="Latitude"
                      value={teleportLat}
                      onChange={(e) => setTeleportLat(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Longitude"
                      value={teleportLon}
                      onChange={(e) => setTeleportLon(e.target.value)}
                    />
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

              {/* Patrol Control Card */}
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Activity size={16} /> Patrouille de zone
                </h3>
                <div className="form-group">
                  <label className="form-label">Type de zone</label>
                  <select
                    value={patrolType}
                    onChange={(e) => setPatrolType(e.target.value as any)}
                  >
                    <option value="circle">Cercle</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                </div>
                {patrolType === "circle" && (
                  <div className="form-group">
                    <label className="form-label">Rayon (mètres)</label>
                    <input
                      type="number"
                      value={patrolRadius}
                      onChange={(e) => setPatrolRadius(e.target.value)}
                    />
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
          )}

          {/* TAB 2: FAVORITES & HISTORY */}
          {activeTab === "favs" && (
            <>
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Star size={16} /> Lieux Favoris
                </h3>
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <button className="btn btn-secondary" onClick={handleExportFavorites}>
                    <Save size={14} /> Exporter
                  </button>
                  <button className="btn btn-secondary" onClick={() => importFileInputRef.current?.click()}>
                    <Plus size={14} /> Importer
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept="application/json"
                    style={{ display: "none" }}
                    onChange={handleImportFileSelected}
                  />
                </div>
                <div className="list-container">
                  {status?.favorites && status.favorites.length > 0 ? (
                    status.favorites.map((fav, i) => (
                      <div className="list-item" key={i}>
                        <div
                          className="list-item-info"
                          onClick={() => setLocation(fav.lat, fav.lon, fav.name)}
                        >
                          <span className="list-item-name">{fav.name}</span>
                          <span className="list-item-coords">
                            {fav.lat.toFixed(5)}, {fav.lon.toFixed(5)}
                          </span>
                        </div>
                        <div className="list-item-actions">
                          <button className="icon-btn" onClick={() => removeFavorite(fav.lat, fav.lon)}>
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", textAlign: "center", padding: "10px" }}>
                      Aucun favori enregistré.
                    </div>
                  )}
                </div>
              </div>

              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Activity size={16} /> Historique Récent
                </h3>
                <div className="list-container">
                  {status?.recentHistory && status.recentHistory.length > 0 ? (
                    status.recentHistory.map((item, i) => (
                      <div className="list-item" key={i}>
                        <div
                          className="list-item-info"
                          onClick={() => setLocation(item.lat, item.lon, item.name)}
                        >
                          <span className="list-item-name">{item.name || "Lieu Injecté"}</span>
                          <span className="list-item-coords">
                            {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", textAlign: "center", padding: "10px" }}>
                      Aucun historique récent.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: ROUTE & SEQUENCES BUILDER */}
          {activeTab === "route" && (
            <>
              {/* Card 1: Interactive Path Drawing */}
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Route size={16} /> Dessin d'Itinéraire
                </h3>
                <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
                  Activez le mode dessin puis cliquez sur la carte pour placer vos points de passage successifs.
                </p>

                <button
                  className={`btn ${isDrawing ? "btn-danger" : "btn-secondary"}`}
                  onClick={toggleDrawMode}
                >
                  {isDrawing ? "Quitter le mode dessin" : "Activer le mode dessin"}
                </button>

                {drawnPointsCount > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
                    <div style={{ fontSize: "0.85rem", color: "#10b981", fontWeight: "600" }}>
                      {drawnPointsCount} points placés sur la carte
                    </div>

                    <div className="form-group">
                      <label className="form-label">Type de déplacement</label>
                      <select
                        value={drawProfile}
                        onChange={(e: any) => setDrawProfile(e.target.value)}
                      >
                        <option value="driving">Voiture</option>
                        <option value="walking">Marche</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Vitesse (km/h)</label>
                      <input
                        type="number"
                        value={drawSpeed}
                        onChange={(e) => setDrawSpeed(e.target.value)}
                      />
                    </div>

                    <label className="switch-label">
                      <span className="form-label">Itinéraire en boucle</span>
                      <span className="switch-control">
                        <input
                          type="checkbox"
                          checked={drawLoop}
                          onChange={(e) => setDrawLoop(e.target.checked)}
                        />
                        <span className="switch-slider"></span>
                      </span>
                    </label>

                    <div className="btn-group">
                      <button className="btn btn-secondary" onClick={clearDrawnPath}>
                        Effacer
                      </button>
                      <button className="btn btn-secondary" onClick={exportDrawnGpx}>
                        Exporter GPX
                      </button>
                      <button className="btn btn-success" onClick={playDrawnPath} disabled={!canSend || drawnPointsCount < 2}>
                        <Play size={12} /> Lancer le trajet
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: GPX Upload */}
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Save size={16} /> Importation GPX
                </h3>
                <div
                  className={`gpx-dropzone ${isDragOver ? "drag-over" : ""}`}
                  onClick={() => document.getElementById("gpx-file-input")?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    id="gpx-file-input"
                    accept=".gpx"
                    style={{ display: "none" }}
                    onChange={handleGpxFileChange}
                  />
                  <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>
                    {gpxFileName ? "Fichier sélectionné :" : "Cliquez ou glissez un fichier .gpx ici"}
                  </div>
                  {gpxFileName && <div className="gpx-file-info">{gpxFileName}</div>}
                  {gpxError && <div className="field-error">{gpxError}</div>}
                </div>

                {gpxContent && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
                    <div className="form-group">
                      <label className="form-label">Vitesse de simulation (km/h)</label>
                      <input
                        type="number"
                        value={gpxSpeed}
                        onChange={(e) => setGpxSpeed(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-success" onClick={handlePlayGpx} disabled={!canSend}>
                      <Play size={12} /> Lancer simulation GPX
                    </button>
                  </div>
                )}
              </div>

              {/* Card 3: Manual Legs builder */}
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Sliders size={16} /> Séquence Multimodale (Manuel)
                </h3>
                
                {/* Legs List */}
                <div className="legs-container">
                  {sequenceLegs.map((leg, index) => (
                    <div className="leg-item" key={index}>
                      <div className="leg-item-header">
                        <span className={`leg-badge ${leg.type}`}>{leg.type}</span>
                        <button
                          className="icon-btn"
                          onClick={() => setSequenceLegs(sequenceLegs.filter((_, i) => i !== index))}
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                        Cible: {leg.end.lat.toFixed(5)}, {leg.end.lon.toFixed(5)}
                        <br />
                        Vitesse: {leg.speed} km/h
                      </div>
                    </div>
                  ))}
                  {sequenceLegs.length === 0 && (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", textAlign: "center", padding: "12px" }}>
                      Aucune étape définie. Saisissez des points ci-dessous.
                    </div>
                  )}
                </div>

                {/* Add new leg form */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Type d'étape</label>
                    <select value={newLegType} onChange={(e: any) => setNewLegType(e.target.value)}>
                      <option value="drive">Voiture (Drive)</option>
                      <option value="walk">Marche (Walk)</option>
                      <option value="flight">Vol direct (Flight)</option>
                      <option value="wait">Pause (Wait)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Coordonnées Destination</label>
                    <div className="search-group">
                      <input
                        type="text"
                        placeholder="Latitude"
                        value={newLegEndLat}
                        onChange={(e) => setNewLegEndLat(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Longitude"
                        value={newLegEndLon}
                        onChange={(e) => setNewLegEndLon(e.target.value)}
                      />
                    </div>
                    {legError && <div className="field-error">{legError}</div>}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Vitesse (km/h)</label>
                    <input
                      type="number"
                      value={newLegSpeed}
                      onChange={(e) => setNewLegSpeed(e.target.value)}
                    />
                  </div>

                  <button className="btn btn-secondary" onClick={handleAddLeg}>
                    <Plus size={14} /> Ajouter étape
                  </button>
                </div>

                {/* Play controls */}
                {sequenceLegs.length > 0 && (
                  <div
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.08)",
                      paddingTop: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px"
                    }}
                  >
                    <label className="switch-label">
                      <span className="form-label">Itinéraire en boucle</span>
                      <span className="switch-control">
                        <input
                          type="checkbox"
                          checked={looping}
                          onChange={(e) => setLooping(e.target.checked)}
                        />
                        <span className="switch-slider"></span>
                      </span>
                    </label>

                    <button className="btn btn-success" onClick={handlePlaySequence} disabled={!canSend}>
                      <Play size={14} /> Lancer la séquence
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 4: SETTINGS */}
          {activeTab === "settings" && (
            <>
              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Settings size={16} /> Connexion au moteur
                </h3>

                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">État du sidecar</span>
                    <span className={`info-value ${engineStatus === "running" ? "green" : engineStatus === "crashed" ? "warning" : ""}`}>
                      {engineStatus === "running" ? "En cours" : engineStatus === "starting" ? "Démarrage" : engineStatus === "crashed" ? "Planté" : "Inconnu"}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Endpoint actuel</span>
                    <span className="info-value compact">{connectionUrl}</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Port d'écoute du moteur</label>
                  <input
                    type="number"
                    value={enginePortInput}
                    onChange={(e) => setEnginePortInput(e.target.value)}
                  />
                  {enginePortError && <span className="field-error">{enginePortError}</span>}
                  <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={handleApplyEnginePort}>
                    <RefreshCw size={14} /> Redémarrer le moteur sur ce port
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">Carte réseau annoncée (découverte iOS)</label>
                  <select
                    value={mdnsInterface ?? ""}
                    onChange={(e) => setMdnsInterface(e.target.value || null)}
                  >
                    <option value="">Toutes les interfaces (auto)</option>
                    {networkInterfaces.map((iface) => (
                      <option key={iface.name} value={iface.name}>
                        {iface.name} ({iface.ip})
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "6px 0 0" }}>
                    Restreint l'adresse annoncée en mDNS à cette carte réseau — utile si plusieurs
                    interfaces (Wi-Fi, Ethernet, VPN) sont actives et que l'app iOS découvre la
                    mauvaise IP.
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Appairage par QR Code</label>
                  <button
                    className="btn btn-secondary"
                    disabled={!qrPairingAddress}
                    onClick={() => setShowQrCode(true)}
                  >
                    <QrCode size={14} /> Afficher le QR Code
                  </button>
                  {!qrPairingAddress && (
                    <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "6px 0 0" }}>
                      Aucune interface réseau locale détectée — connectez-vous à un réseau Wi-Fi
                      ou Ethernet pour générer un QR Code.
                    </p>
                  )}
                </div>
              </div>

              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Smartphone size={16} /> Infos appareil
                </h3>
                <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
                  Disponible uniquement avec le driver go-ios pour le moment.
                </p>

                <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={getDeviceInfo} disabled={!canSend}>
                  <RefreshCw size={14} /> Récupérer les infos
                </button>

                {deviceDetails && (
                  deviceDetails.error ? (
                    <div className="inline-alert" style={{ marginTop: 8 }}>{deviceDetails.error}</div>
                  ) : (
                    <div className="info-grid" style={{ marginTop: 8 }}>
                      <div className="info-item">
                        <span className="info-label">Nom</span>
                        <span className="info-value compact">{deviceDetails.name || "—"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Modèle</span>
                        <span className="info-value compact">{deviceDetails.productType || "—"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">iOS</span>
                        <span className="info-value compact">{deviceDetails.productVersion || "—"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Numéro de série</span>
                        <span className="info-value compact">{deviceDetails.serialNumber || "—"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Adresse WiFi</span>
                        <span className="info-value compact">{deviceDetails.wifiAddress || "—"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Adresse tunnel</span>
                        <span className="info-value compact">{deviceDetails.tunnelAddress || "—"}</span>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="ui-card">
                <h3 className="ui-card-title">
                  <Settings size={16} /> Configuration moteur
                </h3>

                <div className="form-group">
                  <label className="form-label">Port RSD (annoté dans le statut)</label>
                  <input
                    type="number"
                    value={companionPort}
                    onChange={(e) => setCompanionPort(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Driver préféré</label>
                  <select
                    value={preferredDriver}
                    onChange={(e) => setPreferredDriver(e.target.value)}
                  >
                    <option value="go-ios">go-ios (Natif)</option>
                    <option value="pymobiledevice">pymobiledevice3 (Python)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Transport</label>
                  <select
                    value={preferredTransport}
                    onChange={(e) => setPreferredTransport(e.target.value)}
                  >
                    <option value="auto">Auto</option>
                    <option value="usb">USB</option>
                    <option value="wifi">Wi-Fi</option>
                  </select>
                </div>

                <button
                  className="btn"
                  style={{ marginTop: "4px" }}
                  disabled={!canSend}
                  onClick={() => {
                    sendMessage("SWITCH_DRIVER", { driverId: preferredDriver, transport: preferredTransport });
                    showToast("Changement de driver demandé, redémarrage du tunnel...");
                  }}
                >
                  <RefreshCw size={14} /> Appliquer et relancer le tunnel
                </button>

                <label className="switch-label" style={{ margin: "8px 0" }}>
                  <span className="form-label">Mode Éveil</span>
                  <span className="switch-control">
                    <input
                      type="checkbox"
                      checked={isEveilMode}
                      onChange={(e) => setIsEveilMode(e.target.checked)}
                    />
                    <span className="switch-slider"></span>
                  </span>
                </label>

                <label className="switch-label" style={{ margin: "8px 0" }}>
                  <span className="form-label">Variation de vitesse (jitter)</span>
                  <span className="switch-control">
                    <input
                      type="checkbox"
                      checked={jitterEnabled}
                      onChange={(e) => setJitterEnabled(e.target.checked)}
                    />
                    <span className="switch-slider"></span>
                  </span>
                </label>

                {isEveilMode && (
                  <div className="form-group">
                    <label className="form-label">Intervalle Éveil (secondes)</label>
                    <input
                      type="number"
                      value={eveilInterval}
                      onChange={(e) => setEveilInterval(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Serveur de routage (OSRM)</label>
                  <input
                    type="text"
                    value={osrmBaseUrl}
                    placeholder="http://router.project-osrm.org"
                    onChange={(e) => setOsrmBaseUrl(e.target.value)}
                  />
                  <small className="form-hint">
                    Serveur OSRM utilisé pour calculer les itinéraires. Laissez vide pour
                    l'instance publique par défaut, ou indiquez votre serveur auto-hébergé
                    (confidentialité, hors-ligne, limites de débit).
                  </small>
                </div>

                <details className="form-group" style={{ marginTop: "8px" }}>
                  <summary className="form-label" style={{ cursor: "pointer" }}>
                    Cluster — réglages avancés
                  </summary>
                  <div style={{ marginTop: "8px" }}>
                    <label className="form-label">Battement de cœur (s)</label>
                    <input
                      type="number"
                      min={1}
                      value={clusterHeartbeat}
                      onChange={(e) => setClusterHeartbeat(e.target.value)}
                    />
                    <label className="form-label" style={{ marginTop: "8px" }}>
                      Délai avant bascule maître (s)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={clusterMasterDead}
                      onChange={(e) => setClusterMasterDead(e.target.value)}
                    />
                    <label className="form-label" style={{ marginTop: "8px" }}>
                      Timeout requête pair (s)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={clusterPeerTimeout}
                      onChange={(e) => setClusterPeerTimeout(e.target.value)}
                    />
                    <small className="form-hint">
                      Cadence de surveillance et seuil de reprise en haute disponibilité.
                      Les valeurs par défaut conviennent à un réseau local ; augmentez-les
                      pour un lien distant à forte latence.
                    </small>
                  </div>
                </details>

                <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }} disabled={!canSend}>
                  <Save size={14} /> Enregistrer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
      {showQrCode && qrPairingAddress && (
        <div className="qr-overlay" role="dialog" aria-modal="true" onClick={() => setShowQrCode(false)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-card-title" style={{ margin: 0 }}>
              <QrCode size={16} /> Appairer un iPhone
            </h3>
            <div className="qr-modal-code">
              <QRCodeSVG value={qrPairingAddress} size={200} />
            </div>
            <p style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: 0 }}>
              Dans l'app iOS, ouvrez les réglages puis scannez ce code pour vous connecter
              directement à <strong>{qrPairingAddress}</strong>.
            </p>
            <button className="btn btn-secondary" onClick={() => setShowQrCode(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
};

