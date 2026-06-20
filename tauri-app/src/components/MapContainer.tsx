import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useWebSocket, LatLon } from "../context/websocket";
import { SearchBox } from "./SearchBox";

// Fix Leaflet marker icon issues in Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Setup default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Custom Icons
const mockIcon = L.divIcon({
  html: `<div style="background-color: #10b981; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px #10b981;"></div>`,
  className: "custom-mock-icon",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const destIcon = L.divIcon({
  html: `<div style="background-color: #6366f1; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px #6366f1;"></div>`,
  className: "custom-dest-icon",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Helper component to center map on coordinates
const RecenterMap: React.FC<{ coords: LatLon }> = ({ coords }) => {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.lat !== 0 && coords.lon !== 0) {
      map.panTo([coords.lat, coords.lon]);
    }
  }, [coords, map]);
  return null;
};

interface MapEventsHandlerProps {
  onMapClick: (coords: LatLon) => void;
}

const MapEventsHandler: React.FC<MapEventsHandlerProps> = ({ onMapClick }) => {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
};

export const InteractiveMap: React.FC = () => {
  const { status, setLocation, playRoute, playSequence, addFavorite } = useWebSocket();
  const [selectedCoords, setSelectedCoords] = useState<LatLon | null>(null);
  const [favName, setFavName] = useState("");
  const [routeSpeed, setRouteSpeed] = useState(15);
  const [routeProfile, setRouteProfile] = useState<"driving" | "walking" | "cycling">("driving");

  // Map settings state
  const [mapStyle, setMapStyle] = useState<"dark" | "standard" | "satellite">("dark");
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [drawnPoints, setDrawnPoints] = useState<LatLon[]>([]);

  // Listen to draw mode controllers from Sidebar
  useEffect(() => {
    const handleToggleDraw = (e: Event) => {
      const mode = (e as CustomEvent).detail;
      setIsDrawMode(mode);
      if (!mode) setSelectedCoords(null);
    };

    const handleClearDraw = () => {
      setDrawnPoints([]);
      window.dispatchEvent(new CustomEvent("draw-points-updated", { detail: [] }));
    };

    const handlePlayDraw = (e: Event) => {
      const { speed, looping, profile } = (e as CustomEvent).detail;
      if (drawnPoints.length < 2) return;

      // Convert points list to sequence legs
      const legs = [];
      for (let i = 0; i < drawnPoints.length - 1; i++) {
        legs.push({
          type: profile === "walking" ? "walk" : "drive",
          start: drawnPoints[i],
          end: drawnPoints[i + 1],
          speed: speed,
        });
      }

      playSequence(legs, looping);
      setDrawnPoints([]);
      setIsDrawMode(false);
      window.dispatchEvent(new CustomEvent("draw-points-updated", { detail: [] }));
      window.dispatchEvent(new CustomEvent("draw-mode-disabled"));
    };

    window.addEventListener("draw-mode-toggle", handleToggleDraw);
    window.addEventListener("draw-path-clear", handleClearDraw);
    window.addEventListener("draw-path-play", handlePlayDraw);

    return () => {
      window.removeEventListener("draw-mode-toggle", handleToggleDraw);
      window.removeEventListener("draw-path-clear", handleClearDraw);
      window.removeEventListener("draw-path-play", handlePlayDraw);
    };
  }, [drawnPoints, playSequence]);

  // Get active position
  const currentPos: LatLon = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : (status?.deviceInfo ? { lat: 48.8566, lon: 2.3522 } : { lat: 48.8566, lon: 2.3522 }); // Default Paris

  const handleMapClick = (coords: LatLon) => {
    if (isDrawMode) {
      const updated = [...drawnPoints, coords];
      setDrawnPoints(updated);
      window.dispatchEvent(new CustomEvent("draw-points-updated", { detail: updated }));
    } else {
      setSelectedCoords(coords);
    }
  };

  const handleSearchSelect = (lat: number, lon: number, name: string) => {
    const coords = { lat, lon };
    setSelectedCoords(coords);
    // Force set location description state
    setFavName(name);
  };

  const handleTeleport = () => {
    if (selectedCoords) {
      setLocation(selectedCoords.lat, selectedCoords.lon, favName || "Téléportation");
      setSelectedCoords(null);
      setFavName("");
    }
  };

  const handleRoute = () => {
    if (selectedCoords) {
      playRoute(selectedCoords.lat, selectedCoords.lon, routeSpeed, routeProfile);
      setSelectedCoords(null);
    }
  };

  const handleAddFav = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCoords && favName.trim()) {
      addFavorite(selectedCoords.lat, selectedCoords.lon, favName.trim());
      setFavName("");
    }
  };

  // Convert sequence preview points into [lat, lon] tuples
  const sequencePoints: [number, number][] = (status?.currentSequencePreview || []).map((p) => [p.lat, p.lon]);
  const drawLinePoints: [number, number][] = drawnPoints.map((p) => [p.lat, p.lon]);

  const tileUrls = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    standard: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  };

  return (
    <div className="map-viewport">
      {/* Floating Geocoding SearchBox */}
      <SearchBox onSelectLocation={handleSearchSelect} />

      {/* Floating Map Style Selector */}
      <div className="map-style-control">
        <button className={`map-style-btn ${mapStyle === "dark" ? "active" : ""}`} onClick={() => setMapStyle("dark")}>
          Sombre
        </button>
        <button
          className={`map-style-btn ${mapStyle === "standard" ? "active" : ""}`}
          onClick={() => setMapStyle("standard")}
        >
          Plan
        </button>
        <button
          className={`map-style-btn ${mapStyle === "satellite" ? "active" : ""}`}
          onClick={() => setMapStyle("satellite")}
        >
          Sat
        </button>
      </div>

      <MapContainer center={[currentPos.lat, currentPos.lon]} zoom={13} zoomControl={false} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> &copy; ESRI'
          url={tileUrls[mapStyle]}
        />

        <MapEventsHandler onMapClick={handleMapClick} />
        <RecenterMap coords={currentPos} />

        {/* Current Spoofed Location Marker */}
        {currentPos.lat !== 0 && (
          <Marker position={[currentPos.lat, currentPos.lon]} icon={mockIcon}>
            <Popup>
              <div style={{ color: "#334155" }}>
                <strong>Position Actuelle</strong>
                <br />
                Lat: {currentPos.lat.toFixed(6)}
                <br />
                Lon: {currentPos.lon.toFixed(6)}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Selected target marker (on click) */}
        {selectedCoords && !isDrawMode && (
          <Marker position={[selectedCoords.lat, selectedCoords.lon]} icon={destIcon}>
            <Popup minWidth={220}>
              <div style={{ color: "#334155", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div>
                  <strong>Cible Choisie</strong>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                    {selectedCoords.lat.toFixed(6)}, {selectedCoords.lon.toFixed(6)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    onClick={handleTeleport}
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      fontSize: "0.8rem",
                      background: "#10b981",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Téléporter
                  </button>
                  <button
                    onClick={handleRoute}
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      fontSize: "0.8rem",
                      background: "#6366f1",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Itinéraire
                  </button>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "4px 0" }} />

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: "600" }}>Itinéraire Rapide :</label>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <select
                      value={routeProfile}
                      onChange={(e) => setRouteProfile(e.target.value as any)}
                      style={{ fontSize: "0.75rem", padding: "2px" }}
                    >
                      <option value="driving">Voiture</option>
                      <option value="cycling">Vélo</option>
                      <option value="walking">Marche</option>
                    </select>
                    <input
                      type="number"
                      value={routeSpeed}
                      onChange={(e) => setRouteSpeed(Number(e.target.value))}
                      style={{ width: "45px", fontSize: "0.75rem", padding: "2px" }}
                      placeholder="km/h"
                    />
                    <span style={{ fontSize: "0.75rem" }}>km/h</span>
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "4px 0" }} />

                <form onSubmit={handleAddFav} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: "600" }}>Ajouter aux Favoris :</label>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <input
                      type="text"
                      value={favName}
                      onChange={(e) => setFavName(e.target.value)}
                      placeholder="Nom du favori..."
                      style={{ flex: 1, fontSize: "0.75rem", padding: "2px 6px" }}
                      required
                    />
                    <button
                      type="submit"
                      style={{
                        padding: "2px 8px",
                        fontSize: "0.75rem",
                        background: "#f59e0b",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Ajouter
                    </button>
                  </div>
                </form>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Display sequence preview lines */}
        {sequencePoints.length > 0 && (
          <Polyline positions={sequencePoints} color="#6366f1" weight={4} opacity={0.7} dashArray="5, 10" />
        )}

        {/* Display user drawn route lines */}
        {drawLinePoints.length > 0 && (
          <>
            <Polyline positions={drawLinePoints} color="#a855f7" weight={4} opacity={0.8} />
            {drawnPoints.map((p, idx) => (
              <Marker
                key={idx}
                position={[p.lat, p.lon]}
                icon={L.divIcon({
                  html: `<div style="background-color: #a855f7; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 6px #a855f7;"></div>`,
                  className: "custom-draw-dot",
                  iconSize: [10, 10],
                  iconAnchor: [5, 5],
                })}
              />
            ))}
          </>
        )}
      </MapContainer>
    </div>
  );
};
