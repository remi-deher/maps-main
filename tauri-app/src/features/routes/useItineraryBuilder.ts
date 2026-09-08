import { useEffect, useMemo, useState } from "react";
import { LatLon, useEngine } from "../../context/websocket";
import { parseCoordinate } from "../../lib/parse";
import { PlaceKind } from "../../lib/geocoding";
import { osrmBaseUrl, fetchOptimizedStopOrder, getRailRouterUrl } from "../../lib/osrm";
import { useRouteDragAndDrop } from "./useRouteDragAndDrop";
import {
  buildPlaybackLegs,
  calculateFallbackDurationSeconds,
  calculateHaversineTotal,
  calculateStopSchedule,
  resolveRouteOptions,
} from "./routePlanner";
import {
  defaultDwellMinutes,
  isRoadRoutable,
  makeWaypointId,
  OSRM_PROFILE,
  suggestLegMode,
  type LegMode,
  type RouteOption,
  type RouteSegment,
  type Waypoint,
} from "./routeModel";
import { autoModeToast } from "./routePresentation";
import { patchWithNearestPlace } from "./routeEffects";

// The itinerary builder's state and behaviour, extracted from RouteModePanel.
//
// The panel had ~400 lines of state and handlers above ~330 lines of JSX, which
// meant none of the interesting rules — a removed stop shifting the multi-select
// indices, a new stop inheriting the previous leg's mode, the debounced route
// resolution — could be exercised without rendering the whole builder.
//
// The waypoint list itself stays owned by the parent (the map draws from it),
// so it comes in as a prop; everything else below is local to the builder.

export interface ItineraryBuilderOptions {
  waypoints: Waypoint[];
  // A dispatch, not a plain setter, so async reverse-geocoding can patch a
  // stop's name without racing other list edits.
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>;
  start: LatLon | null;
  setStart: (s: LatLon | null) => void;
  onRouteSegmentsChange?: (segments: RouteSegment[] | null) => void;
  showToast: (message: string) => void;
}

export type ItineraryBuilder = ReturnType<typeof useItineraryBuilder>;

export function useItineraryBuilder({
  waypoints,
  setWaypoints,
  start,
  setStart,
  onRouteSegmentsChange,
  showToast,
}: ItineraryBuilderOptions) {
  const { canSend, status, playSequence } = useEngine();

  // PlaySequence (unlike PlayRoute) has no server-side default for a missing
  // leg start, so the first leg is seeded with the actual current position.
  const currentPos: LatLon = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : { lat: 48.8566, lon: 2.3522 };

  // Custom start point comes from the parent (null = live current position).
  // Its display name stays local — it's only set here when chosen by search.
  const [startName, setStartName] = useState<string | null>(null);
  const effectiveStart: LatLon = start ?? currentPos;
  const effectiveStartLat = effectiveStart.lat;
  const effectiveStartLon = effectiveStart.lon;

  const [speedFactor, setSpeedFactor] = useState("1");
  const [looping, setLooping] = useState(false);
  // Departure clock time used to compute per-stop arrival/departure times.
  // datetime-local format "YYYY-MM-DDTHH:mm" defaulting to now (local).
  const [departureTime, setDepartureTime] = useState(() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });

  const reorderWaypoint = (from: number, to: number) => {
    if (from === to) return;
    const next = [...waypoints];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWaypoints(next);
  };
  const { draggedIndex, getDragHandlers } = useRouteDragAndDrop(reorderWaypoint);

  const [osrmLoading, setOsrmLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  // Resolved route options: road alternatives (single road mode), or a single
  // multi-segment route otherwise. `selectedAlt` picks which one is displayed.
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedAlt, setSelectedAlt] = useState(0);
  // Road classes to avoid (OSRM `exclude`). Public demo server honours these
  // only partially — see the hint shown below the toggles.
  const [excludeMotorway, setExcludeMotorway] = useState(false);
  const [excludeToll, setExcludeToll] = useState(false);
  const [excludeFerry, setExcludeFerry] = useState(false);
  const excludeList = useMemo(
    () =>
      [
        excludeMotorway ? "motorway" : null,
        excludeToll ? "toll" : null,
        excludeFerry ? "ferry" : null,
      ].filter(Boolean) as string[],
    [excludeMotorway, excludeToll, excludeFerry]
  );
  const excludeKey = excludeList.join(",");

  // Multi-select for bulk mode editing
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Manual-coordinate entry (the "Coordonnées" add method)
  const [coordLat, setCoordLat] = useState("");
  const [coordLon, setCoordLon] = useState("");
  const [coordError, setCoordError] = useState("");

  // New stops inherit the last leg's mode (or drive by default), so a route
  // stays single-mode until the user deliberately changes a leg.
  const nextMode = (): LegMode => waypoints[waypoints.length - 1]?.mode ?? "drive";

  const addWaypoint = (lat: number, lon: number, name: string, kind?: PlaceKind) => {
    const prevKind = waypoints[waypoints.length - 1]?.kind ?? null;
    const auto = suggestLegMode(prevKind, kind ?? null);
    if (auto) showToast(autoModeToast(auto));
    setWaypoints([
      ...waypoints,
      { id: makeWaypointId(), lat, lon, name, mode: auto ?? nextMode(), kind: kind ?? null, waitMinutes: defaultDwellMinutes(kind ?? null) },
    ]);
  };

  const setLegWait = (index: number, minutes: number) => {
    setWaypoints(waypoints.map((wp, i) => (i === index ? { ...wp, waitMinutes: Math.max(0, Math.min(600, minutes)) } : wp)));
  };

  const removeWaypoint = (index: number) => {
    setWaypoints(waypoints.filter((_, i) => i !== index));
    // The multi-selection is index-based, so removing a stop has to shift every
    // selected index above it down — otherwise a later bulk apply would hit the
    // wrong rows.
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const setLegMode = (index: number, mode: LegMode) => {
    setWaypoints(waypoints.map((wp, i) => (i === index ? { ...wp, mode } : wp)));
  };

  const applyModeToSelected = (mode: LegMode) => {
    setWaypoints(waypoints.map((wp, i) => (selected.has(i) ? { ...wp, mode } : wp)));
  };

  const toggleSelected = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleSelecting = () => {
    setSelecting((v) => !v);
    setSelected(new Set());
  };

  const handleAddCoords = () => {
    const lat = parseCoordinate(coordLat, -90, 90);
    const lon = parseCoordinate(coordLon, -180, 180);
    if (lat === null || lon === null) {
      setCoordError("Coordonnées invalides : latitude -90 à 90, longitude -180 à 180.");
      return;
    }
    setCoordError("");
    const placeholder = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const id = makeWaypointId();
    setWaypoints([...waypoints, { id, lat, lon, name: placeholder, mode: nextMode() }]);
    patchWithNearestPlace(setWaypoints, id, lat, lon, (m) => showToast(autoModeToast(m)));
    setCoordLat("");
    setCoordLon("");
  };

  // Resolve the route through the shared route planner. The hook owns only UI
  // state; transport-specific resolution lives in routePlanner.
  useEffect(() => {
    if (waypoints.length === 0) {
      setRouteOptions([]);
      setOsrmLoading(false);
      onRouteSegmentsChange?.(null);
      return;
    }

    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      setOsrmLoading(true);
      try {
        const options = await resolveRouteOptions({
          waypoints,
          effectiveStart: { lat: effectiveStartLat, lon: effectiveStartLon },
          base: osrmBaseUrl(status?.osrmBaseUrl),
          railBase: getRailRouterUrl(),
          exclude: excludeList,
          departureTime,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRouteOptions(options);
        setSelectedAlt(0);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setRouteOptions([]);
      } finally {
        if (!controller.signal.aborted) setOsrmLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [waypoints, effectiveStartLat, effectiveStartLon, excludeList, excludeKey, departureTime, status?.osrmBaseUrl, onRouteSegmentsChange]);

  const selectedRoute: RouteOption | null = routeOptions[Math.min(selectedAlt, routeOptions.length - 1)] ?? null;

  // Push the selected route's typed segments to the map whenever they change.
  useEffect(() => {
    onRouteSegmentsChange?.(selectedRoute ? selectedRoute.segments : null);
  }, [selectedRoute, onRouteSegmentsChange]);

  const haversineTotal = calculateHaversineTotal(waypoints, effectiveStart);
  const fallbackDurationSeconds = calculateFallbackDurationSeconds(waypoints, effectiveStart);
  const isRealDistance = selectedRoute !== null;
  const estimatedMeters = selectedRoute ? selectedRoute.distance : haversineTotal;
  const displayDurationSeconds = selectedRoute ? selectedRoute.duration : fallbackDurationSeconds;
  const segs = selectedRoute && selectedRoute.segments.length === waypoints.length ? selectedRoute.segments : null;

  const schedule = calculateStopSchedule(waypoints, effectiveStart, selectedRoute, departureTime, haversineTotal);
  const finalArrival = schedule.length > 0 ? schedule[schedule.length - 1].arrival : null;

  // The time is "estimated" when a leg wasn't resolved by a real router — no
  // route yet, an OSRM fallback, or a train without a rail router. Flight is
  // never flagged: its straight line is the correct great-circle path.
  const usesPublicOsrm = !status?.osrmBaseUrl?.trim();
  const hasTrain = waypoints.some((w) => w.mode === "train");
  const railConfigured = !!getRailRouterUrl();
  const timeIsEstimated = !selectedRoute || selectedRoute.estimated;
  const estimateHint =
    hasTrain && !railConfigured
      ? "Train estimé en ligne droite. Renseignez une URL de routeur ferroviaire dans les Réglages pour suivre les voies."
      : usesPublicOsrm
      ? "Temps partiellement estimé (le serveur OSRM public ne route que la voiture). Configurez un serveur auto-hébergé pour des durées piéton précises."
      : "Temps partiellement estimé : un tronçon n'a pas pu être résolu par OSRM.";

  const handlePlay = () => {
    if (waypoints.length === 0) return;
    if (!canSend) {
      showToast("Moteur hors ligne: impossible de lancer l'itinéraire.");
      return;
    }
    const factor = parseFloat(speedFactor.replace(",", ".")) || 1;
    const legs = buildPlaybackLegs(waypoints, effectiveStart, selectedRoute, schedule, factor);

    playSequence(legs, looping);
    showToast("Itinéraire envoyé au moteur.");
    setWaypoints([]);
    setSelecting(false);
    setSelected(new Set());
    // Reset the start back to "Ma position" for the next itinerary.
    setStart(null);
    setStartName(null);
  };

  // Reorder the stops to minimize total travel (OSRM /trip). Uses the first
  // stop's profile as a single approximation — per-leg modes can't be mixed in
  // one trip query — and keeps the start fixed as the origin.
  // /trip only routes on a road profile, so it's offered only when every stop
  // is road-routable (drive/walk).
  const optimizeEligible = waypoints.length >= 2 && waypoints.every((w) => isRoadRoutable(w.mode));

  const handleOptimize = async () => {
    if (!optimizeEligible) return;
    setOptimizing(true);
    try {
      const base = osrmBaseUrl(status?.osrmBaseUrl);
      const profile = OSRM_PROFILE[waypoints[0].mode] ?? "driving";
      const order = await fetchOptimizedStopOrder(base, effectiveStart, waypoints, profile, { exclude: excludeList });
      setWaypoints(order.map((i) => waypoints[i]));
      showToast("Étapes réordonnées pour le trajet le plus court.");
    } catch {
      showToast("Optimisation indisponible (OSRM).");
    } finally {
      setOptimizing(false);
    }
  };

  const clearStart = () => {
    setStart(null);
    setStartName(null);
  };

  const chooseStart = (lat: number, lon: number, name: string) => {
    setStart({ lat, lon });
    setStartName(name);
  };

  return {
    currentPos,
    startName,
    clearStart,
    chooseStart,

    departureTime,
    setDepartureTime,
    speedFactor,
    setSpeedFactor,
    looping,
    setLooping,

    draggedIndex,
    getDragHandlers,
    selecting,
    toggleSelecting,
    selected,
    toggleSelected,
    applyModeToSelected,
    removeWaypoint,
    setLegMode,
    setLegWait,
    addWaypoint,

    coordLat,
    setCoordLat,
    coordLon,
    setCoordLon,
    coordError,
    handleAddCoords,

    excludeMotorway,
    setExcludeMotorway,
    excludeToll,
    setExcludeToll,
    excludeFerry,
    setExcludeFerry,
    excludeList,
    usesPublicOsrm,

    osrmLoading,
    optimizing,
    optimizeEligible,
    handleOptimize,
    routeOptions,
    selectedAlt,
    setSelectedAlt,
    selectedRoute,
    isRealDistance,
    estimatedMeters,
    displayDurationSeconds,
    timeIsEstimated,
    estimateHint,
    schedule,
    finalArrival,
    segs,

    handlePlay,
  };
}
