import React, { useEffect, useState } from "react";
import { Route, Save, Sliders, Trash, Plus, Play } from "lucide-react";
import { useWebSocket } from "../../context/websocket";
import { parseCoordinate } from "../../lib/parse";

interface SequencesTabProps {
  showToast: (message: string) => void;
}

/// Route/sequences tab (map drawing, GPX import, manual multimodal legs),
/// extracted from the Sidebar god-component. Owns all of its builder state.
export const SequencesTab: React.FC<SequencesTabProps> = ({ showToast }) => {
  const { canSend, playCustomGpx, playSequence } = useWebSocket();

  // Manual legs builder
  const [sequenceLegs, setSequenceLegs] = useState<any[]>([]);
  const [looping, setLooping] = useState(false);
  const [newLegType, setNewLegType] = useState<"drive" | "walk" | "flight" | "wait">("drive");
  const [newLegStartLat, setNewLegStartLat] = useState("");
  const [newLegStartLon, setNewLegStartLon] = useState("");
  const [newLegEndLat, setNewLegEndLat] = useState("");
  const [newLegEndLon, setNewLegEndLon] = useState("");
  const [newLegSpeed, setNewLegSpeed] = useState("15");
  const [legError, setLegError] = useState("");

  // GPX upload
  const [gpxContent, setGpxContent] = useState("");
  const [gpxFileName, setGpxFileName] = useState("");
  const [gpxSpeed, setGpxSpeed] = useState("25");
  const [gpxError, setGpxError] = useState("");

  // Map drawing
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPoints, setDrawnPoints] = useState<any[]>([]);
  const [drawnPointsCount, setDrawnPointsCount] = useState(0);
  const [drawSpeed, setDrawSpeed] = useState("15");
  const [drawLoop, setDrawLoop] = useState(false);
  const [drawProfile, setDrawProfile] = useState<"driving" | "walking">("driving");
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const handlePointsUpdated = (e: Event) => {
      const points = (e as CustomEvent).detail;
      setDrawnPoints(points);
      setDrawnPointsCount(points.length);
    };
    const handleModeDisabled = () => setIsDrawing(false);
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

  const clearDrawnPath = () => window.dispatchEvent(new CustomEvent("draw-path-clear"));

  const playDrawnPath = () => {
    window.dispatchEvent(
      new CustomEvent("draw-path-play", {
        detail: { speed: parseFloat(drawSpeed) || 15, looping: drawLoop, profile: drawProfile },
      })
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".gpx")) {
      setGpxError("");
      setGpxFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => setGpxContent(event.target?.result as string);
      reader.readAsText(file);
    } else {
      setGpxError("Déposez un fichier GPX valide.");
    }
  };

  const exportDrawnGpx = () => {
    if (drawnPoints.length === 0) return;
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="GPS-Mock v3" xmlns="http://www.topografix.com/GPX/1/1">\n';
    gpx += '  <trk>\n    <name>Drawn Path</name>\n    <trkseg>\n';
    drawnPoints.forEach((p) => {
      gpx += `      <trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>\n`;
    });
    gpx += '    </trkseg>\n  </trk>\n</gpx>';
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
      reader.onload = (event) => setGpxContent(event.target?.result as string);
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
      endTime: Date.now() + 60000,
    };

    setSequenceLegs([...sequenceLegs, newLeg]);
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

  return (
    <>
      {/* Card 1: Interactive Path Drawing */}
      <div className="ui-card">
        <h3 className="ui-card-title">
          <Route size={16} /> Dessin d'Itinéraire
        </h3>
        <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
          Activez le mode dessin puis cliquez sur la carte pour placer vos points de passage successifs.
        </p>

        <button className={`btn ${isDrawing ? "btn-danger" : "btn-secondary"}`} onClick={toggleDrawMode}>
          {isDrawing ? "Quitter le mode dessin" : "Activer le mode dessin"}
        </button>

        {drawnPointsCount > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
            <div style={{ fontSize: "0.85rem", color: "#10b981", fontWeight: "600" }}>
              {drawnPointsCount} points placés sur la carte
            </div>

            <div className="form-group">
              <label className="form-label">Type de déplacement</label>
              <select value={drawProfile} onChange={(e: any) => setDrawProfile(e.target.value)}>
                <option value="driving">Voiture</option>
                <option value="walking">Marche</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Vitesse (km/h)</label>
              <input type="number" value={drawSpeed} onChange={(e) => setDrawSpeed(e.target.value)} />
            </div>

            <label className="switch-label">
              <span className="form-label">Itinéraire en boucle</span>
              <span className="switch-control">
                <input type="checkbox" checked={drawLoop} onChange={(e) => setDrawLoop(e.target.checked)} />
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
          role="button"
          tabIndex={0}
          aria-label="Importer un fichier GPX : cliquez pour parcourir ou glissez-déposez"
          onClick={() => document.getElementById("gpx-file-input")?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              document.getElementById("gpx-file-input")?.click();
            }
          }}
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
              <input type="number" value={gpxSpeed} onChange={(e) => setGpxSpeed(e.target.value)} />
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

        <div className="legs-container">
          {sequenceLegs.map((leg, index) => (
            <div className="leg-item" key={index}>
              <div className="leg-item-header">
                <span className={`leg-badge ${leg.type}`}>{leg.type}</span>
                <button
                  className="icon-btn"
                  onClick={() => setSequenceLegs(sequenceLegs.filter((_, i) => i !== index))}
                  aria-label={`Supprimer l'étape ${index + 1}`}
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

        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
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
            <input type="number" value={newLegSpeed} onChange={(e) => setNewLegSpeed(e.target.value)} />
          </div>

          <button className="btn btn-secondary" onClick={handleAddLeg}>
            <Plus size={14} /> Ajouter étape
          </button>
        </div>

        {sequenceLegs.length > 0 && (
          <div
            style={{
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <label className="switch-label">
              <span className="form-label">Itinéraire en boucle</span>
              <span className="switch-control">
                <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} />
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
  );
};
