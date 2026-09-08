import React, { useState } from "react";
import { Play, Save } from "lucide-react";
import { useEngine } from "../../context/websocket";

// GPX track replay. Deliberately its own component with its own state: it
// bypasses the waypoint model entirely (the engine parses the <trkpt> tags
// itself), so it shares nothing with the itinerary builder beyond sitting in
// the same panel.
export const GpxReplayPanel: React.FC<{ showToast: (message: string) => void }> = ({ showToast }) => {
  const { canSend, playCustomGpx } = useEngine();

  const [gpxContent, setGpxContent] = useState("");
  const [gpxFileName, setGpxFileName] = useState("");
  const [gpxSpeed, setGpxSpeed] = useState("25");
  const [gpxError, setGpxError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const readFile = (file: File) => {
    setGpxError("");
    setGpxFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => setGpxContent(event.target?.result as string);
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    // A drop accepts anything, so the extension is checked here — the file
    // picker below already filters on accept=".gpx".
    if (file && file.name.endsWith(".gpx")) {
      readFile(file);
    } else {
      setGpxError("Déposez un fichier GPX valide.");
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

  const openFilePicker = () => document.getElementById("gpx-file-input")?.click();

  return (
    <details className="ui-card tool-section">
      <summary className="ui-card-title tool-section-summary">
        <Save size={16} /> Importation GPX
      </summary>
      <div
        className={`gpx-dropzone ${isDragOver ? "drag-over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Importer un fichier GPX : cliquez pour parcourir ou glissez-déposez"
        onClick={openFilePicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFilePicker();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="gpx-file-input"
          accept=".gpx"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
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
    </details>
  );
};
