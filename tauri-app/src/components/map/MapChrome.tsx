import React, { useState } from "react";
import { Crosshair, ScrollText, Settings, Sliders, Smartphone, Star } from "lucide-react";
import { SearchBox } from "../SearchBox";
import { SettingsModal } from "../SettingsModal";
import { LogsModal } from "../LogsModal";
import { FavoritesModal } from "../FavoritesModal";
import { DeviceModal } from "../DeviceModal";
import { EngineStatusFrame } from "../EngineStatusFrame";
import { TelemetryWidget } from "../TelemetryWidget";
import type { LatLon, Status } from "../../types/engine";
import type { MapMode } from "../../features/map/mapModel";

export type MapStyle = "dark" | "standard" | "satellite";

const MAP_STYLES: Array<{ id: MapStyle; label: string }> = [
  { id: "dark", label: "Sombre" },
  { id: "standard", label: "Plan" },
  { id: "satellite", label: "Sat" },
];

// Everything floating *over* the map: the search box, the recenter button, the
// panel dock and its four modals, the engine status frame, the style picker and
// the telemetry pill.
//
// None of it is inside the Leaflet context, and none of it touches the map's
// data — which is exactly why it was worth lifting out of MapContainer: what is
// drawn on the map and what floats above it are two separate concerns that were
// sharing one 660-line file.
export const MapChrome: React.FC<{
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
  currentPos: LatLon;
  status: Status | null;
  onSearchSelect: (lat: number, lon: number, name: string) => void;
}> = ({ mapMode, setMapMode, mapStyle, setMapStyle, currentPos, status, onSearchSelect }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showDevice, setShowDevice] = useState(false);

  // The dock's four buttons differ only by icon, label and which panel they
  // open, so they are described rather than repeated.
  const dockPanels = [
    { label: "Réglages", Icon: Settings, open: () => setShowSettings(true) },
    { label: "Journaux", Icon: ScrollText, open: () => setShowLogs(true) },
    { label: "Favoris", Icon: Star, open: () => setShowFavorites(true) },
    { label: "Périphérique", Icon: Smartphone, open: () => setShowDevice(true) },
  ];

  return (
    <>
      {/* Tools entry — opens the contextual tool frame (defaults to Itinéraire).
          Only shown in explore mode; once open, the frame's own tabs take over. */}
      {mapMode === "explore" && (
        <button
          className="map-tools-toggle"
          onClick={() => setMapMode("route")}
          title="Outils de trajet"
          aria-label="Ouvrir les outils de trajet"
        >
          <Sliders size={15} /> Outils
        </button>
      )}

      <SearchBox onSelectLocation={onSearchSelect} near={currentPos} />

      <button
        className="map-recenter-btn"
        onClick={() => window.dispatchEvent(new CustomEvent("recenter-map"))}
        title="Centrer sur ma position"
        aria-label="Centrer sur ma position"
      >
        <Crosshair size={18} />
      </button>

      {/* Floating app-panel dock — settings / logs / favorites / device grouped
          into a single translucent surface instead of four separate buttons. */}
      <div className="map-dock" role="group" aria-label="Panneaux">
        {dockPanels.map(({ label, Icon, open }) => (
          <button key={label} className="map-dock-btn" onClick={open} title={label} aria-label={label}>
            <Icon size={18} />
          </button>
        ))}
      </div>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <LogsModal open={showLogs} onClose={() => setShowLogs(false)} />
      <FavoritesModal open={showFavorites} onClose={() => setShowFavorites(false)} />
      <DeviceModal open={showDevice} onClose={() => setShowDevice(false)} />

      {/* Kept visible — connection health is glanceable. */}
      <EngineStatusFrame />

      <div className="map-style-control" role="group" aria-label="Style de carte">
        {MAP_STYLES.map(({ id, label }) => (
          <button
            key={id}
            className={`map-style-btn ${mapStyle === id ? "active" : ""}`}
            aria-pressed={mapStyle === id}
            onClick={() => setMapStyle(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Collapsed pill, expands on click. */}
      {status && <TelemetryWidget status={status} currentPos={currentPos} />}
    </>
  );
};
