import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, Rectangle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useWebSocket, LatLon } from "../context/websocket";
import { SearchBox } from "./SearchBox";
import { MapActionSheet } from "./MapActionSheet";
import { SettingsModal } from "./SettingsModal";
import { LogsModal } from "./LogsModal";
import { FavoritesModal } from "./FavoritesModal";
import { EngineStatusFrame } from "./EngineStatusFrame";
import { TelemetryWidget } from "./TelemetryWidget";
import { DeviceModal } from "./DeviceModal";
import { RouteModePanel, Waypoint, AddMethod, RouteSegment, MODE_META, defaultDwellMinutes } from "./RouteModePanel";
import { PatrolModePanel } from "./PatrolModePanel";
import { reverseGeocode, reverseGeocodeDetailed, autoLegMode } from "../lib/geocoding";
import { osrmBaseUrl, snapToRoad } from "../lib/osrm";
import { Crosshair, Route, ScrollText, Settings, ShieldCheck, Sliders, Smartphone, Star, X } from "lucide-react";

export type MapMode = "explore" | "route" | "patrol";

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
  html: `<div style="background-color: #0ea5e9; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px #0ea5e9;"></div>`,
  className: "custom-dest-icon",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const realIcon = L.divIcon({
  html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px #ef4444;"></div>`,
  className: "custom-real-icon",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Helper component to center map on coordinates and keep following position
// updates until the user manually pans the map away.
const RecenterMap: React.FC<{ coords: LatLon }> = ({ coords }) => {
  const map = useMap();
  const hasCentered = React.useRef(false);
  const isFollowing = React.useRef(true);

  // Stop auto-following as soon as the user drags the map themselves.
  useEffect(() => {
    const handleDragStart = () => {
      isFollowing.current = false;
    };
    map.on("dragstart", handleDragStart);
    return () => {
      map.off("dragstart", handleDragStart);
    };
  }, [map]);

  useEffect(() => {
    if (!coords || (coords.lat === 0 && coords.lon === 0)) return;

    if (!hasCentered.current) {
      map.setView([coords.lat, coords.lon], 13);
      hasCentered.current = true;
    } else if (isFollowing.current) {
      map.panTo([coords.lat, coords.lon]);
    }
  }, [coords, map]);

  useEffect(() => {
    const handleRecenter = () => {
      if (coords && coords.lat !== 0 && coords.lon !== 0) {
        isFollowing.current = true;
        map.panTo([coords.lat, coords.lon]);
      }
    };
    window.addEventListener("recenter-map", handleRecenter);
    return () => {
      window.removeEventListener("recenter-map", handleRecenter);
    };
  }, [coords, map]);

  return null;
};

// Keeps Leaflet's internal size in sync with its container (panel collapse/expand, window resize)
const MapResizeHandler: React.FC = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

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
  const { status, setLocation, addFavorite, updatePatrolZone, canSend } = useWebSocket();
  const [selectedCoords, setSelectedCoords] = useState<LatLon | null>(null);
  const [selectedPlaceName, setSelectedPlaceName] = useState<string | null>(null);
  const [favName, setFavName] = useState("");
  // Bumped on each new explore-mode selection so a late reverse-geocode result
  // can't relabel a target the user has since replaced.
  const selectionToken = React.useRef(0);

  // Map settings state
  const [mapStyle, setMapStyle] = useState<"dark" | "standard" | "satellite">("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showDevice, setShowDevice] = useState(false);

  // Map mode (Explorer / Itinéraire / Patrouille) and the state each mode's
  // floating tool panel shares with the map for live preview/rendering.
  const [mapMode, setMapMode] = useState<MapMode>("explore");
  const [routeWaypoints, setRouteWaypoints] = useState<Waypoint[]>([]);
  const [routeAddMethod, setRouteAddMethod] = useState<AddMethod>("search");
  const [routeStart, setRouteStart] = useState<LatLon | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[] | null>(null);
  const [routeToast, setRouteToast] = useState<string | null>(null);
  const [patrolCenter, setPatrolCenter] = useState<LatLon | null>(null);

  // Get active position
  const currentPos: LatLon = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : (status?.deviceInfo ? { lat: 48.8566, lon: 2.3522 } : { lat: 48.8566, lon: 2.3522 }); // Default Paris

  const handleMapClick = (coords: LatLon) => {
    if (mapMode === "route") {
      // Only the "Sur la carte" add method turns clicks into stops, so panning
      // around in search/coords mode doesn't accidentally drop waypoints. New
      // stops inherit the previous leg's mode (drive by default), and are named
      // from the nearest place via reverse geocoding once it resolves.
      if (routeAddMethod === "map") {
        const inheritedMode = routeWaypoints[routeWaypoints.length - 1]?.mode ?? "drive";
        const isRoad = inheritedMode === "drive" || inheritedMode === "walk";
        // Snap road-mode stops to the nearest road (so they don't land in the
        // middle of a building); leave train/flight stops at the raw click.
        const addAt = (pt: LatLon) => {
          const placeholder = `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`;
          setRouteWaypoints((prev) => [...prev, { lat: pt.lat, lon: pt.lon, name: placeholder, mode: inheritedMode }]);
          // Reverse-geocode to name the stop and, if it's a station/airport
          // matching the previous stop, auto-switch this leg's mode.
          reverseGeocodeDetailed(pt.lat, pt.lon).then((res) => {
            if (!res) return;
            setRouteWaypoints((prev) =>
              prev.map((wp, i) => {
                if (!(wp.lat === pt.lat && wp.lon === pt.lon && wp.name === placeholder)) return wp;
                const auto = autoLegMode(prev[i - 1]?.kind ?? null, res.kind) as Waypoint["mode"] | null;
                if (auto && auto !== wp.mode) {
                  setRouteToast(`Mode ${MODE_META[auto].label} détecté — modifiable`);
                  window.setTimeout(() => setRouteToast(null), 3000);
                }
                const waitMinutes = wp.waitMinutes ?? defaultDwellMinutes(res.kind);
                return { ...wp, name: res.name, kind: res.kind, mode: auto ?? wp.mode, waitMinutes };
              })
            );
          });
        };
        if (isRoad) {
          const base = osrmBaseUrl(status?.osrmBaseUrl);
          snapToRoad(base, coords.lat, coords.lon, "driving").then((snapped) => addAt(snapped ?? coords));
        } else {
          addAt(coords);
        }
      }
    } else if (mapMode === "patrol") {
      setPatrolCenter(coords);
    } else {
      // Explore mode: open the action sheet, then name the target from the
      // nearest place (reverse geocoding) and prefill the favorite name.
      const token = ++selectionToken.current;
      setSelectedCoords(coords);
      setSelectedPlaceName(null);
      setFavName("");
      reverseGeocode(coords.lat, coords.lon).then((name) => {
        if (!name || selectionToken.current !== token) return;
        setSelectedPlaceName(name);
        setFavName(name);
      });
    }
  };

  const handleSearchSelect = (lat: number, lon: number, name: string) => {
    const coords = { lat, lon };
    // A search result is already named — bump the token so any pending
    // reverse-geocode from a prior map click can't overwrite it.
    selectionToken.current += 1;
    setSelectedCoords(coords);
    setSelectedPlaceName(name);
    setFavName(name);
  };

  const handleTeleport = () => {
    if (selectedCoords && canSend) {
      setLocation(selectedCoords.lat, selectedCoords.lon, favName || "Téléportation");
      setSelectedCoords(null);
      setSelectedPlaceName(null);
      setFavName("");
    }
  };

  // "Itinéraire" in the action sheet seeds the unified route builder with this
  // point and opens it, rather than running a one-shot direct route.
  const handleAddToRoute = () => {
    if (!selectedCoords) return;
    const name = selectedPlaceName || `${selectedCoords.lat.toFixed(5)}, ${selectedCoords.lon.toFixed(5)}`;
    const inheritedMode = routeWaypoints[routeWaypoints.length - 1]?.mode ?? "drive";
    setRouteWaypoints((prev) => [...prev, { lat: selectedCoords.lat, lon: selectedCoords.lon, name, mode: inheritedMode }]);
    setRouteAddMethod("search");
    setMapMode("route");
    setSelectedCoords(null);
    setSelectedPlaceName(null);
  };

  const handleAddFav = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCoords && favName.trim() && canSend) {
      addFavorite(selectedCoords.lat, selectedCoords.lon, favName.trim());
      setFavName("");
    }
  };

  // Convert sequence preview points into [lat, lon] tuples
  const sequencePoints: [number, number][] = (status?.currentSequencePreview || []).map((p) => [p.lat, p.lon]);

  const tileUrls = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    standard: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  };

  return (
    <div className="map-viewport">
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

      {/* Floating Geocoding SearchBox */}
      <SearchBox onSelectLocation={handleSearchSelect} near={currentPos} />

      {/* Floating Recenter Button */}
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
        <button
          className="map-dock-btn"
          onClick={() => setShowSettings(true)}
          title="Réglages"
          aria-label="Réglages"
        >
          <Settings size={18} />
        </button>
        <button
          className="map-dock-btn"
          onClick={() => setShowLogs(true)}
          title="Journaux"
          aria-label="Journaux"
        >
          <ScrollText size={18} />
        </button>
        <button
          className="map-dock-btn"
          onClick={() => setShowFavorites(true)}
          title="Favoris"
          aria-label="Favoris"
        >
          <Star size={18} />
        </button>
        <button
          className="map-dock-btn"
          onClick={() => setShowDevice(true)}
          title="Périphérique"
          aria-label="Périphérique"
        >
          <Smartphone size={18} />
        </button>
      </div>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <LogsModal open={showLogs} onClose={() => setShowLogs(false)} />
      <FavoritesModal open={showFavorites} onClose={() => setShowFavorites(false)} />
      <DeviceModal open={showDevice} onClose={() => setShowDevice(false)} />

      {/* Floating Engine status frame (kept visible — connection health is glanceable) */}
      <EngineStatusFrame />

      {/* Floating Map Style Selector */}
      <div className="map-style-control" role="group" aria-label="Style de carte">
        <button
          className={`map-style-btn ${mapStyle === "dark" ? "active" : ""}`}
          aria-pressed={mapStyle === "dark"}
          onClick={() => setMapStyle("dark")}
        >
          Sombre
        </button>
        <button
          className={`map-style-btn ${mapStyle === "standard" ? "active" : ""}`}
          aria-pressed={mapStyle === "standard"}
          onClick={() => setMapStyle("standard")}
        >
          Plan
        </button>
        <button
          className={`map-style-btn ${mapStyle === "satellite" ? "active" : ""}`}
          aria-pressed={mapStyle === "satellite"}
          onClick={() => setMapStyle("satellite")}
        >
          Sat
        </button>
      </div>

      {/* Floating Telemetry Status Widget — collapsed pill, expands on click */}
      {status && <TelemetryWidget status={status} currentPos={currentPos} />}

      <MapContainer center={[currentPos.lat, currentPos.lon]} zoom={13} zoomControl={false} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> &copy; ESRI'
          url={tileUrls[mapStyle]}
        />

        <MapEventsHandler onMapClick={handleMapClick} />
        <RecenterMap coords={currentPos} />
        <MapResizeHandler />

        {/* Current Spoofed Location Marker */}
        {currentPos.lat !== 0 && (
          <Marker position={[currentPos.lat, currentPos.lon]} icon={mockIcon}>
            <Popup>
              <div style={{ color: "#334155" }}>
                <strong>Position actuelle</strong>
                <br />
                Lat: {currentPos.lat.toFixed(6)}
                <br />
                Lon: {currentPos.lon.toFixed(6)}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Real Device Location Marker */}
        {status?.lastRealLocation && status.lastRealLocation.lat !== 0 && (
          <Marker position={[status.lastRealLocation.lat, status.lastRealLocation.lon]} icon={realIcon}>
            <Popup>
              <div style={{ color: "#334155" }}>
                <strong>Position réelle (iPhone)</strong>
                <br />
                Lat: {status.lastRealLocation.lat.toFixed(6)}
                <br />
                Lon: {status.lastRealLocation.lon.toFixed(6)}
                <br />
                Dérive : {Math.round(status.lastRealLocation.drift || 0)} m
              </div>
            </Popup>
          </Marker>
        )}

        {/* Polyline showing drift/distance between simulated and real location */}
        {status?.lastRealLocation && status.lastRealLocation.lat !== 0 && currentPos.lat !== 0 && (
          <Polyline
            positions={[
              [currentPos.lat, currentPos.lon],
              [status.lastRealLocation.lat, status.lastRealLocation.lon],
            ]}
            color="#ef4444"
            weight={3}
            opacity={0.8}
            dashArray="6, 6"
          />
        )}

        {/* Selected target marker (on click) */}
        {selectedCoords && mapMode === "explore" && (
          <Marker position={[selectedCoords.lat, selectedCoords.lon]} icon={destIcon} />
        )}

        {/* Patrol center preview marker (before activation) */}
        {mapMode === "patrol" && patrolCenter && (
          <Marker
            position={[patrolCenter.lat, patrolCenter.lon]}
            icon={L.divIcon({
              html: `<div style="background-color: #f59e0b; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 10px #f59e0b;"></div>`,
              className: "custom-patrol-preview-icon",
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })}
          />
        )}

        {/* Render Patrol Zone (Circle or Rectangle) */}
        {status?.patrolZone?.active && status.patrolZone.type === "circle" && status.patrolZone.center && (
          <>
            <Circle
              center={[status.patrolZone.center.lat, status.patrolZone.center.lon]}
              radius={status.patrolZone.radius || 200}
              pathOptions={{
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.15,
                weight: 2,
              }}
            />
            <Marker
              position={[status.patrolZone.center.lat, status.patrolZone.center.lon]}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();
                  updatePatrolZone({
                    ...status.patrolZone!,
                    center: { lat: position.lat, lon: position.lng },
                  });
                },
              }}
              icon={L.divIcon({
                html: `<div style="background-color: #f59e0b; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 6px #f59e0b;"></div>`,
                className: "patrol-center-dot",
                iconSize: [12, 12],
                iconAnchor: [6, 6],
              })}
            />
          </>
        )}

        {status?.patrolZone?.active && status.patrolZone.type === "rectangle" && status.patrolZone.bounds && (
          <Rectangle
            bounds={[
              [status.patrolZone.bounds.sw.lat, status.patrolZone.bounds.sw.lon],
              [status.patrolZone.bounds.ne.lat, status.patrolZone.bounds.ne.lon],
            ]}
            pathOptions={{
              color: "#10b981",
              fillColor: "#10b981",
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
        )}

        {/* Display sequence preview lines */}
        {sequencePoints.length > 0 && (
          <Polyline positions={sequencePoints} color="#0f766e" weight={4} opacity={0.75} dashArray="5, 10" />
        )}

        {/* Destination-search waypoints (Itinéraire) — one polyline per resolved
            segment, styled by transport mode (train/flight dashed & coloured);
            falls back to a dashed straight-line preview while it loads. */}
        {mapMode === "route" && routeWaypoints.length > 0 && (
          <>
            {routeSegments && routeSegments.length > 0 ? (
              routeSegments.map((seg, i) =>
                seg.coords.length > 1 ? (
                  <Polyline
                    key={i}
                    positions={seg.coords.map((p): [number, number] => [p.lat, p.lon])}
                    color={MODE_META[seg.mode].color}
                    weight={4}
                    opacity={0.85}
                    dashArray={MODE_META[seg.mode].dashed ? "6, 8" : undefined}
                  />
                ) : null
              )
            ) : (
              <Polyline
                positions={[
                  [(routeStart ?? currentPos).lat, (routeStart ?? currentPos).lon],
                  ...routeWaypoints.map((wp): [number, number] => [wp.lat, wp.lon]),
                ]}
                color="#14b8a6"
                weight={3}
                opacity={0.7}
                dashArray="4, 8"
              />
            )}
            {/* Custom start marker ("D" for départ) — only when overridden, since
                the live position already has its own marker. */}
            {routeStart && (
              <Marker
                position={[routeStart.lat, routeStart.lon]}
                icon={L.divIcon({
                  html: `<div style="background-color: #0ea5e9; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 8px #0ea5e9; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; font-family: sans-serif;">D</div>`,
                  className: "custom-start-icon",
                  iconSize: [22, 22],
                  iconAnchor: [11, 11],
                })}
              >
                <Popup>Départ</Popup>
              </Marker>
            )}
            {routeWaypoints.map((wp, idx) => (
              <Marker
                key={idx}
                position={[wp.lat, wp.lon]}
                icon={L.divIcon({
                  html: `<div style="background-color: #14b8a6; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 8px #14b8a6; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; font-family: sans-serif;">${idx + 1}</div>`,
                  className: "custom-waypoint-icon",
                  iconSize: [22, 22],
                  iconAnchor: [11, 11],
                })}
              >
                <Popup>{wp.name}</Popup>
              </Marker>
            ))}
          </>
        )}
      </MapContainer>

      {/* Auto-detected transport mode notice (map-click stops) */}
      {routeToast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{routeToast}</div>
        </div>
      )}

      {/* Contextual action sheet for the selected target (Explorer mode) */}
      {selectedCoords && mapMode === "explore" && (
        <MapActionSheet
          coords={selectedCoords}
          placeName={selectedPlaceName}
          canSend={canSend}
          favName={favName}
          setFavName={setFavName}
          onTeleport={handleTeleport}
          onAddToRoute={handleAddToRoute}
          onAddFavorite={handleAddFav}
          onClose={() => {
            setSelectedCoords(null);
            setSelectedPlaceName(null);
          }}
        />
      )}

      {/* Contextual tool frame — one surface whose content adapts to the
          selected context (Itinéraire / Patrouille); replaces the always-on
          three-button mode switcher. */}
      {mapMode !== "explore" && (
        <div className="map-tool-panel">
          <div className="map-tool-header">
            <div className="map-tool-tabs" role="tablist" aria-label="Outils de la carte">
              <button
                className={`map-tool-tab ${mapMode === "route" ? "active" : ""}`}
                role="tab"
                aria-selected={mapMode === "route"}
                onClick={() => setMapMode("route")}
                type="button"
              >
                <Route size={15} /> Itinéraire
              </button>
              <button
                className={`map-tool-tab ${mapMode === "patrol" ? "active" : ""}`}
                role="tab"
                aria-selected={mapMode === "patrol"}
                onClick={() => setMapMode("patrol")}
                type="button"
              >
                <ShieldCheck size={15} /> Patrouille
              </button>
            </div>
            <button
              className="icon-btn"
              onClick={() => setMapMode("explore")}
              title="Fermer les outils"
              aria-label="Fermer les outils"
            >
              <X size={16} />
            </button>
          </div>

          {mapMode === "route" && (
            <RouteModePanel
              waypoints={routeWaypoints}
              setWaypoints={setRouteWaypoints}
              addMethod={routeAddMethod}
              setAddMethod={setRouteAddMethod}
              start={routeStart}
              setStart={setRouteStart}
              onRouteSegmentsChange={setRouteSegments}
            />
          )}

          {mapMode === "patrol" && (
            <PatrolModePanel patrolCenter={patrolCenter} setPatrolCenter={setPatrolCenter} />
          )}
        </div>
      )}
    </div>
  );
};
