import React, { useState } from "react";
import {
  Activity,
  Star,
  Settings,
  MapPin,
  Trash,
  Plus,
  Play,
  Square,
  RefreshCw,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Route,
  Smartphone,
  Save
} from "lucide-react";
import { useWebSocket } from "../context/websocket";

export const Sidebar: React.FC = () => {
  const {
    isConnected,
    status,
    telemetry,
    setLocation,
    clearLocation,
    playSequence,
    playCustomGpx,
    relance,
    saveSettings,
    removeFavorite,
  } = useWebSocket();

  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"control" | "favs" | "route" | "settings">("control");

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

  // Config settings form state
  const [companionPort, setCompanionPort] = useState("8080");
  const [preferredDriver, setPreferredDriver] = useState("go-ios");
  const [isEveilMode, setIsEveilMode] = useState(true);
  const [eveilInterval, setEveilInterval] = useState("15");

  // GPX Upload state
  const [gpxContent, setGpxContent] = useState("");
  const [gpxFileName, setGpxFileName] = useState("");
  const [gpxSpeed, setGpxSpeed] = useState("25");

  // Map Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPointsCount, setDrawnPointsCount] = useState(0);
  const [drawSpeed, setDrawSpeed] = useState("15");
  const [drawLoop, setDrawLoop] = useState(false);
  const [drawProfile, setDrawProfile] = useState<"driving" | "walking">("driving");

  React.useEffect(() => {
    const handlePointsUpdated = (e: Event) => {
      const points = (e as CustomEvent).detail;
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

  const handleGpxFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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
    if (gpxContent) {
      playCustomGpx(gpxContent, parseFloat(gpxSpeed) || 25);
    }
  };

  const triggerTeleport = () => {
    const lat = parseFloat(teleportLat);
    const lon = parseFloat(teleportLon);
    if (!isNaN(lat) && !isNaN(lon)) {
      setLocation(lat, lon, "Téléportation Manuelle");
    }
  };

  const handleAddLeg = () => {
    const startLat = parseFloat(newLegStartLat);
    const startLon = parseFloat(newLegStartLon);
    const endLat = parseFloat(newLegEndLat);
    const endLon = parseFloat(newLegEndLon);
    const speed = parseFloat(newLegSpeed);

    if (isNaN(endLat) || isNaN(endLon)) {
      alert("Veuillez saisir des coordonnées de destination valides.");
      return;
    }

    const newLeg = {
      type: newLegType,
      start: isNaN(startLat) || isNaN(startLon) ? null : { lat: startLat, lon: startLon },
      end: { lat: endLat, lon: endLon },
      speed: isNaN(speed) ? 15 : speed,
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
    // Map legs, filling missing starts with previous ends
    const preparedLegs = sequenceLegs.map((leg, index) => {
      if (!leg.start) {
        const prevLeg = sequenceLegs[index - 1];
        leg.start = prevLeg ? prevLeg.end : { lat: 48.8566, lon: 2.3522 };
      }
      return leg;
    });

    playSequence(preparedLegs, looping);
  };

  const handleSaveSettings = () => {
    saveSettings({
      companionPort: parseInt(companionPort),
      preferredDriver: preferredDriver as any,
      isEveilMode,
      eveilInterval: parseInt(eveilInterval)
    });
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
                      <span className="info-label">Packet Loss</span>
                      <span className="info-value">{telemetry.packetLoss}%</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Uptime</span>
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
                      <span className="info-label">Driver Actif</span>
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
                  <button className="btn" onClick={triggerTeleport}>
                    Téléporter
                  </button>
                </div>

                <div className="btn-group" style={{ marginTop: "8px" }}>
                  <button className="btn btn-secondary" onClick={relance}>
                    <RefreshCw size={14} /> Relancer
                  </button>
                  <button className="btn btn-danger" onClick={clearLocation}>
                    <Square size={14} /> Arrêter
                  </button>
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
                  {isDrawing ? "Quitter le Mode Dessin" : "Activer le Mode Dessin"}
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
                      <button className="btn btn-success" onClick={playDrawnPath}>
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
                <div className="gpx-dropzone" onClick={() => document.getElementById("gpx-file-input")?.click()}>
                  <input
                    type="file"
                    id="gpx-file-input"
                    accept=".gpx"
                    style={{ display: "none" }}
                    onChange={handleGpxFileChange}
                  />
                  <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>
                    {gpxFileName ? "Fichier sélectionné :" : "Cliquez pour charger un fichier .gpx"}
                  </div>
                  {gpxFileName && <div className="gpx-file-info">{gpxFileName}</div>}
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
                    <button className="btn btn-success" onClick={handlePlayGpx}>
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

                    <button className="btn btn-success" onClick={handlePlaySequence}>
                      <Play size={14} /> Lancer la Séquence
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
                  <Settings size={16} /> Configuration Moteur
                </h3>

                <div className="form-group">
                  <label className="form-label">Port du Serveur Go</label>
                  <input
                    type="number"
                    value={companionPort}
                    onChange={(e) => setCompanionPort(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Driver Préféré</label>
                  <select
                    value={preferredDriver}
                    onChange={(e) => setPreferredDriver(e.target.value)}
                  >
                    <option value="go-ios">go-ios (Natif)</option>
                    <option value="pymobiledevice">pymobiledevice3 (Python)</option>
                  </select>
                </div>

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

                <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }}>
                  <Save size={14} /> Enregistrer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
