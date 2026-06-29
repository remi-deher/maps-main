import { useState, useRef, useEffect } from "react";
import type { LatLon } from "../../types/engine";
import type { MapMode } from "../../components/MapContainer";
import { type Waypoint, type AddMethod, type RouteSegment, makeWaypointId } from "../routes/routeModel";
import { patchWithNearestPlace } from "../routes/routeEffects";
import { reverseGeocode } from "../../lib/geocoding";
import { osrmBaseUrl, snapToRoad } from "../../lib/osrm";
import { autoModeToast } from "../routes/routePresentation";

export function useMapInteractionController(status: any, canSend: boolean, setLocation: any, addFavorite: any) {
  const [mapMode, setMapMode] = useState<MapMode>("explore");
  const [routeWaypoints, setRouteWaypoints] = useState<Waypoint[]>([]);
  const [routeAddMethod, setRouteAddMethod] = useState<AddMethod>("search");
  const [routeStart, setRouteStart] = useState<LatLon | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[] | null>(null);
  const [routeToast, setRouteToast] = useState<string | null>(null);
  const [patrolCenter, setPatrolCenter] = useState<LatLon | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<LatLon | null>(null);
  const [selectedPlaceName, setSelectedPlaceName] = useState<string | null>(null);
  const [favName, setFavName] = useState("");
  const selectionToken = useRef(0);
  const geocodeAbortRef = useRef(new AbortController());

  useEffect(() => () => geocodeAbortRef.current.abort(), []);

  const handleMapClick = (coords: LatLon) => {
    if (mapMode === "route") {
      if (routeAddMethod === "map") {
        const inheritedMode = routeWaypoints[routeWaypoints.length - 1]?.mode ?? "drive";
        const isRoad = inheritedMode === "drive" || inheritedMode === "walk";
        const addAt = (pt: LatLon) => {
          const placeholder = `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`;
          const id = makeWaypointId();
          setRouteWaypoints((prev) => [...prev, { id, lat: pt.lat, lon: pt.lon, name: placeholder, mode: inheritedMode }]);
          patchWithNearestPlace(
            setRouteWaypoints,
            id,
            pt.lat,
            pt.lon,
            (auto) => {
              setRouteToast(autoModeToast(auto));
              window.setTimeout(() => setRouteToast(null), 3000);
            },
            geocodeAbortRef.current.signal
          );
        };
        if (isRoad) {
          const base = osrmBaseUrl(status?.osrmBaseUrl);
          snapToRoad(base, coords.lat, coords.lon, "driving", geocodeAbortRef.current.signal).then((snapped) => addAt(snapped ?? coords));
        } else {
          addAt(coords);
        }
      }
    } else if (mapMode === "patrol") {
      setPatrolCenter(coords);
    } else {
      const token = ++selectionToken.current;
      setSelectedCoords(coords);
      setSelectedPlaceName(null);
      setFavName("");
      reverseGeocode(coords.lat, coords.lon, geocodeAbortRef.current.signal).then((name) => {
        if (!name || selectionToken.current !== token) return;
        setSelectedPlaceName(name);
        setFavName(name);
      });
    }
  };

  const handleSearchSelect = (lat: number, lon: number, name: string) => {
    const coords = { lat, lon };
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

  const handleAddToRoute = () => {
    if (!selectedCoords) return;
    const name = selectedPlaceName || `${selectedCoords.lat.toFixed(5)}, ${selectedCoords.lon.toFixed(5)}`;
    const inheritedMode = routeWaypoints[routeWaypoints.length - 1]?.mode ?? "drive";
    setRouteWaypoints((prev) => [...prev, { id: makeWaypointId(), lat: selectedCoords.lat, lon: selectedCoords.lon, name, mode: inheritedMode }]);
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

  return {
    mapMode, setMapMode,
    routeWaypoints, setRouteWaypoints,
    routeAddMethod, setRouteAddMethod,
    routeStart, setRouteStart,
    routeSegments, setRouteSegments,
    routeToast, setRouteToast,
    patrolCenter, setPatrolCenter,
    selectedCoords, setSelectedCoords,
    selectedPlaceName, setSelectedPlaceName,
    favName, setFavName,
    handleMapClick,
    handleSearchSelect,
    handleTeleport,
    handleAddToRoute,
    handleAddFav
  };
}
