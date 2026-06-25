import React, { useEffect, useState } from "react";
import {
  Save,
  Play,
  Car,
  Footprints,
  Train,
  Plane,
  MapPin,
  X,
  GripVertical,
  Search,
  MousePointerClick,
  Hash,
  CheckSquare,
  LocateFixed,
  Wand2,
  Clock,
} from "lucide-react";
import { useWebSocket, LatLon } from "../context/websocket";
import { parseCoordinate } from "../lib/parse";
import { reverseGeocodeDetailed, autoLegMode, PlaceKind } from "../lib/geocoding";
import { planTransitJourney, isTransitEnabled } from "../lib/transit";
import {
  osrmBaseUrl,
  fetchRoute,
  fetchAlternatives,
  fetchOptimizedStopOrder,
  straightLineRoute,
  simplifyGeometry,
  getRailRouterUrl,
  makeWaitLeg,
  haversineMeters,
} from "../lib/osrm";
import { DestinationSearchInput } from "./DestinationSearchInput";

export type LegMode = "drive" | "walk" | "train" | "flight";

/// Stable per-stop identifier, generated once at creation — lets async
/// patches (reverse-geocode resolution) target the exact stop they were
/// fired for, even if the list is reordered/edited before they resolve.
/// Matching by lat/lon/placeholder text alone could hit a different stop
/// that happens to share the same coordinates and not-yet-resolved name.
export const makeWaypointId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface Waypoint extends LatLon {
  id: string;
  name: string;
  /// Travel mode of the leg arriving at this stop (from the previous stop, or
  /// the current position for the first one).
  mode: LegMode;
  /// Transport kind of the place (station/airport), used to auto-pick the mode
  /// when two consecutive stops are the same kind.
  kind?: PlaceKind;
  /// Dwell/wait time at this stop, in minutes (boarding, transfer…).
  waitMinutes?: number;
}

export type AddMethod = "search" | "map" | "coords";

/// Default dwell (minutes) suggested for a stop based on its place kind.
export const defaultDwellMinutes = (kind: PlaceKind): number =>
  kind === "airport" ? 60 : kind === "station" ? 10 : 0;

/// A resolved route as a list of typed segments (one per leg in mixed/non-road
/// routes, or a single segment for a road alternative).
export interface RouteSegment {
  coords: LatLon[];
  mode: LegMode;
  /// Travel duration of this segment in seconds (for schedule computation).
  duration?: number;
  /// Real timetable info for a train leg resolved via the transit API.
  transit?: { departureMs: number; arrivalMs: number; label?: string };
}
interface RouteOption {
  distance: number; // meters
  duration: number; // seconds
  estimated: boolean; // includes a straight-line / non-router leg (not flight, which is exact)
  segments: RouteSegment[];
}

// Only road-network modes have an OSRM profile. train/flight are resolved
// without OSRM (straight line, or a pluggable rail router for train).
const OSRM_PROFILE: Partial<Record<LegMode, string>> = { drive: "driving", walk: "foot" };

const isRoadRoutable = (mode: LegMode): boolean => mode === "drive" || mode === "walk";

// Realistic per-mode cruising speeds (km/h). Used for both the time estimate
// and, multiplied by the playback factor, the actual simulated speed per leg.
const MODE_DEFAULT_KMH: Record<LegMode, number> = { drive: 50, walk: 5, train: 120, flight: 800 };

// Backend leg type each frontend mode maps to (no Go change needed): train and
// flight both play as the engine's straight-line `flight` leg.
const BACKEND_LEG_TYPE: Record<LegMode, string> = {
  drive: "drive",
  walk: "walk",
  train: "flight",
  flight: "flight",
};

// Display metadata (label, icon, map line style) per mode.
export const MODE_META: Record<LegMode, { label: string; icon: React.ComponentType<{ size?: number }>; color: string; dashed: boolean }> = {
  drive: { label: "Voiture", icon: Car, color: "#14b8a6", dashed: false },
  walk: { label: "Marche", icon: Footprints, color: "#5eead4", dashed: false },
  train: { label: "Train", icon: Train, color: "#a855f7", dashed: true },
  flight: { label: "Avion", icon: Plane, color: "#38bdf8", dashed: true },
};

const MODE_ORDER: LegMode[] = ["drive", "walk", "train", "flight"];

function formatDuration(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}

/// Compact icon-toggle row — mirrors Google Maps' segmented controls.
const SegmentedToggle: React.FC<{
  options: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;
  value: string;
  onChange: (id: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="mode-toggle" role="group">
    {options.map((opt) => {
      const Icon = opt.icon;
      return (
        <button
          key={opt.id}
          type="button"
          className={`mode-toggle-btn ${value === opt.id ? "active" : ""}`}
          aria-pressed={value === opt.id}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => onChange(opt.id)}
        >
          <Icon size={16} />
          <span>{opt.label}</span>
        </button>
      );
    })}
  </div>
);

interface RouteModePanelProps {
  waypoints: Waypoint[];
  // Dispatch (not a plain setter) so async reverse-geocoding can patch a stop's
  // name with a functional update without racing other list edits.
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>;
  addMethod: AddMethod;
  setAddMethod: (m: AddMethod) => void;
  // Custom start point (null = use live current position). Lifted so the map
  // can draw the start marker / preview line from the same origin.
  start: LatLon | null;
  setStart: (s: LatLon | null) => void;
  // Typed route segments for the map (one polyline per segment, styled by mode),
  // or null to fall back to the dashed straight-line preview.
  onRouteSegmentsChange?: (segments: RouteSegment[] | null) => void;
}

/// Names a freshly-added coordinate stop from its nearest place (reverse
/// geocoding) and, if it's a station/airport matching the previous stop,
/// auto-switches the leg's mode. Patches by the stop's stable `id` (not
/// coords/placeholder text) so a reorder/removal/re-add at the same spot in
/// between can't mislabel a different stop; an optional `signal` lets the
/// caller cancel the geocode if the stop is removed before it resolves.
export function patchWithNearestPlace(
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>,
  id: string,
  lat: number,
  lon: number,
  onAuto?: (mode: LegMode) => void,
  signal?: AbortSignal
) {
  reverseGeocodeDetailed(lat, lon, signal).then((res) => {
    if (!res || signal?.aborted) return;
    setWaypoints((prev) =>
      prev.map((wp, i) => {
        if (wp.id !== id) return wp;
        const auto = autoLegMode(prev[i - 1]?.kind ?? null, res.kind) as LegMode | null;
        if (auto && auto !== wp.mode) onAuto?.(auto);
        // Suggest a dwell from the resolved kind unless the user already set one.
        const waitMinutes = wp.waitMinutes ?? defaultDwellMinutes(res.kind);
        return { ...wp, name: res.name, kind: res.kind, mode: auto ?? wp.mode, waitMinutes };
      })
    );
  });
}

/// Toast message shown when a leg's transport mode is auto-detected.
export const autoModeToast = (mode: LegMode): string => `Mode ${MODE_META[mode].label} détecté — modifiable`;

/// Unified itinerary builder — one block where stops are added by search, map
/// click or manual coordinates, sharing a single ordered list. Travel mode is
/// set per leg (each row's toggle, or a multi-select bulk apply); speed/loop
/// and a per-leg OSRM distance-duration preview are shared. GPX track replay
/// stays a separate collapsed section since it bypasses the waypoint model.
export const RouteModePanel: React.FC<RouteModePanelProps> = ({
  waypoints,
  setWaypoints,
  addMethod,
  setAddMethod,
  start,
  setStart,
  onRouteSegmentsChange,
}) => {
  const { canSend, status, playCustomGpx, playSequence } = useWebSocket();

  // PlaySequence (unlike PlayRoute) has no server-side default for a missing
  // leg start, so the first leg is seeded with the actual current position.
  const currentPos: LatLon = status?.navigation?.progress
    ? { lat: status.navigation.progress.lat, lon: status.navigation.progress.lon }
    : { lat: 48.8566, lon: 2.3522 };

  // Custom start point comes from the parent (null = live current position).
  // Its display name stays local — it's only set here when chosen by search.
  const [startName, setStartName] = useState<string | null>(null);
  const effectiveStart: LatLon = start ?? currentPos;

  const [speedFactor, setSpeedFactor] = useState("1");
  const [looping, setLooping] = useState(false);
  // Departure clock time used to compute per-stop arrival/departure times.
  // datetime-local format "YYYY-MM-DDTHH:mm" defaulting to now (local).
  const [departureTime, setDepartureTime] = useState(() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
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
  const excludeList = [
    excludeMotorway ? "motorway" : null,
    excludeToll ? "toll" : null,
    excludeFerry ? "ferry" : null,
  ].filter(Boolean) as string[];
  const excludeKey = excludeList.join(",");

  // Multi-select for bulk mode editing
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Manual-coordinate entry (the "Coordonnées" add method)
  const [coordLat, setCoordLat] = useState("");
  const [coordLon, setCoordLon] = useState("");
  const [coordError, setCoordError] = useState("");

  // GPX upload (separate track-replay path)
  const [gpxContent, setGpxContent] = useState("");
  const [gpxFileName, setGpxFileName] = useState("");
  const [gpxSpeed, setGpxSpeed] = useState("25");
  const [gpxError, setGpxError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  // New stops inherit the last leg's mode (or drive by default), so a route
  // stays single-mode until the user deliberately changes a leg.
  const nextMode = (): LegMode => waypoints[waypoints.length - 1]?.mode ?? "drive";

  const addWaypoint = (lat: number, lon: number, name: string, kind?: PlaceKind) => {
    const prevKind = waypoints[waypoints.length - 1]?.kind ?? null;
    const auto = autoLegMode(prevKind, kind ?? null) as LegMode | null;
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
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const reorderWaypoint = (from: number, to: number) => {
    if (from === to) return;
    const next = [...waypoints];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWaypoints(next);
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

  const singleMode = waypoints.length > 0 && waypoints.every((w) => w.mode === waypoints[0].mode);
  // Road alternatives only make sense when the whole route is a single road mode.
  const altEligible = singleMode && isRoadRoutable(waypoints[0]?.mode);

  // Resolve the route. A single road mode → OSRM alternatives. Otherwise resolve
  // each leg by its mode (OSRM for road, straight line for flight, the pluggable
  // rail router or straight line for train) into one multi-segment option.
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
      const base = osrmBaseUrl(status?.osrmBaseUrl);
      const railBase = getRailRouterUrl();
      const exclude = excludeList;

      // Resolves one leg to a typed segment + distance/duration. Never throws —
      // failures fall back to a straight line flagged `estimated` (flight is the
      // exception: its straight line is the correct great-circle path).
      const resolveLeg = async (
        from: LatLon,
        to: LatLon,
        mode: LegMode
      ): Promise<{ coords: LatLon[]; distance: number; duration: number; estimated: boolean }> => {
        const kmh = MODE_DEFAULT_KMH[mode];
        try {
          if (isRoadRoutable(mode)) {
            const r = await fetchRoute(base, [from, to], OSRM_PROFILE[mode]!, { signal: controller.signal, exclude });
            return { coords: r.geometry, distance: r.distance, duration: r.duration, estimated: false };
          }
          if (mode === "train" && railBase) {
            const r = await fetchRoute(railBase, [from, to], "driving", { signal: controller.signal });
            return { coords: r.geometry, distance: r.distance, duration: r.duration, estimated: false };
          }
          // flight (always) or train without a rail router → straight line.
          const s = straightLineRoute(from, to, kmh);
          return { coords: s.geometry, distance: s.distance, duration: s.duration, estimated: mode === "train" };
        } catch (error) {
          if ((error as Error).name === "AbortError") throw error;
          const s = straightLineRoute(from, to, kmh);
          return { coords: s.geometry, distance: s.distance, duration: s.duration, estimated: true };
        }
      };

      try {
        if (altEligible) {
          const mode = waypoints[0].mode;
          const alts = await fetchAlternatives(base, [effectiveStart, ...waypoints], OSRM_PROFILE[mode]!, {
            signal: controller.signal,
            exclude,
          });
          if (controller.signal.aborted) return;
          setRouteOptions(
            alts.map((a) => ({
              distance: a.distance,
              duration: a.duration,
              estimated: false,
              segments: [{ coords: a.geometry, mode }],
            }))
          );
          setSelectedAlt(0);
        } else {
          // Sequential resolution maintaining a wall-clock so train legs can ask
          // the transit API for the next real departure after they're reached.
          const legs = waypoints.map((wp, i) => ({
            from: i === 0 ? effectiveStart : (waypoints[i - 1] as LatLon),
            to: wp as LatLon,
            mode: wp.mode,
          }));
          const depBase = (() => {
            const t = new Date(departureTime);
            return isNaN(t.getTime()) ? Date.now() : t.getTime();
          })();
          const transitOn = isTransitEnabled();

          const segments: RouteSegment[] = [];
          let totalDistance = 0;
          let totalDuration = 0;
          let anyEstimated = false;
          let clock = depBase;

          for (let i = 0; i < legs.length; i++) {
            const { from, to, mode } = legs[i];
            let coords: LatLon[];
            let distance: number;
            let duration: number;
            let estimated = false;
            let transit: RouteSegment["transit"];

            if (mode === "train" && transitOn) {
              const j = await planTransitJourney(from, to, new Date(clock), controller.signal);
              if (controller.signal.aborted) return;
              if (j) {
                coords = j.geometry;
                duration = Math.max(1, (j.arrivalMs - j.departureMs) / 1000);
                distance = haversineMeters(from, to);
                transit = { departureMs: j.departureMs, arrivalMs: j.arrivalMs, label: j.label };
                clock = j.arrivalMs; // anchor to the real arrival
              } else {
                const r = await resolveLeg(from, to, mode);
                if (controller.signal.aborted) return;
                ({ coords, distance, duration } = r);
                estimated = true;
                clock += duration * 1000;
              }
            } else {
              const r = await resolveLeg(from, to, mode);
              if (controller.signal.aborted) return;
              ({ coords, distance, duration, estimated } = r);
              clock += duration * 1000;
            }

            // Manual dwell advances the clock for the NEXT leg's departAfter,
            // except before a transit train (whose wait is the real train wait).
            const nextIsTransitTrain = i + 1 < legs.length && legs[i + 1].mode === "train" && transitOn;
            if (!nextIsTransitTrain) clock += (waypoints[i].waitMinutes ?? 0) * 60000;

            segments.push({ coords, mode, duration, transit });
            totalDistance += distance;
            totalDuration += duration;
            anyEstimated = anyEstimated || estimated;
          }

          setSelectedAlt(0);
          setRouteOptions([{ distance: totalDistance, duration: totalDuration, estimated: anyEstimated, segments }]);
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setRouteOptions([]); // total failure → straight-line fallback below
      } finally {
        // `finally` runs even on the early `return`s above for an aborted/
        // superseded request — guard so a stale request's cleanup can't
        // flip loading back to false while a newer request is still in flight.
        if (!controller.signal.aborted) setOsrmLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, effectiveStart.lat, effectiveStart.lon, excludeKey, departureTime]);

  const selectedRoute: RouteOption | null = routeOptions[Math.min(selectedAlt, routeOptions.length - 1)] ?? null;

  // Push the selected route's typed segments to the map whenever they change.
  useEffect(() => {
    onRouteSegmentsChange?.(selectedRoute ? selectedRoute.segments : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute]);

  const haversineTotal = waypoints.reduce((total, wp, index) => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    return total + haversineMeters(from, wp);
  }, 0);
  // Instant transport-aware time estimate (per-leg distance ÷ that leg's mode
  // speed) shown until OSRM's road-type-accurate duration arrives.
  const fallbackDurationSeconds = waypoints.reduce((total, wp, index) => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    const dist = haversineMeters(from, wp);
    return total + dist / ((MODE_DEFAULT_KMH[wp.mode] * 1000) / 3600);
  }, 0);
  const isRealDistance = selectedRoute !== null;
  const estimatedMeters = selectedRoute ? selectedRoute.distance : haversineTotal;
  const displayDurationSeconds = selectedRoute ? selectedRoute.duration : fallbackDurationSeconds;

  // Travel duration (seconds) of the leg arriving at stop `index`. Uses the
  // resolved per-leg segment duration when available (multi-segment routes);
  // for a single road alternative, distributes the total by haversine share;
  // otherwise falls back to a haversine/mode-speed estimate.
  const legTravelSeconds = (index: number): number => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    const wp = waypoints[index];
    if (selectedRoute && selectedRoute.segments.length === waypoints.length) {
      return selectedRoute.segments[index].duration ?? 0;
    }
    if (selectedRoute && haversineTotal > 0) {
      return selectedRoute.duration * (haversineMeters(from, wp) / haversineTotal);
    }
    return haversineMeters(from, wp) / ((MODE_DEFAULT_KMH[wp.mode] * 1000) / 3600);
  };

  // Per-stop computed schedule from the chosen departure time + leg durations
  // (× speed factor) + dwell. The trailing stop's dwell is shown but not played.
  const departureBase = (() => {
    const t = new Date(departureTime);
    return isNaN(t.getTime()) ? new Date() : t;
  })();
  // Realistic wall-clock schedule. Train legs resolved via the transit API
  // anchor to real departure/arrival times; the dwell at a stop becomes the
  // real wait for the next train when applicable, otherwise the manual dwell.
  // Uses true durations (not the simulation speed factor).
  interface StopSchedule {
    arrival: Date;
    departure: Date;
    wait: number; // minutes
    label?: string; // train name on the leg arriving here
  }
  const segs = selectedRoute && selectedRoute.segments.length === waypoints.length ? selectedRoute.segments : null;
  const schedule: StopSchedule[] = (() => {
    let clock = departureBase.getTime();
    const out: StopSchedule[] = [];
    for (let i = 0; i < waypoints.length; i++) {
      const seg = segs?.[i];
      let arrivalMs: number;
      if (seg?.transit) {
        arrivalMs = seg.transit.arrivalMs;
      } else {
        arrivalMs = clock + legTravelSeconds(i) * 1000;
      }
      // Dwell at this stop depends on whether the NEXT leg is a real train.
      const nextSeg = segs?.[i + 1];
      let departureMs: number;
      let waitMin: number;
      if (i < waypoints.length - 1 && nextSeg?.transit) {
        departureMs = nextSeg.transit.departureMs;
        waitMin = Math.max(0, Math.round((departureMs - arrivalMs) / 60000));
      } else {
        waitMin = waypoints[i].waitMinutes ?? 0;
        departureMs = arrivalMs + waitMin * 60000;
      }
      out.push({ arrival: new Date(arrivalMs), departure: new Date(departureMs), wait: waitMin, label: seg?.transit?.label });
      clock = departureMs;
    }
    return out;
  })();
  const finalArrival = schedule.length > 0 ? schedule[schedule.length - 1].arrival : null;
  const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
    // Per-leg segment geometry is available (and index-aligned) only in the
    // multi-segment resolution path, which is exactly where train legs live.
    const perLegSegments =
      selectedRoute && selectedRoute.segments.length === waypoints.length ? selectedRoute.segments : null;

    const lastIndex = waypoints.length - 1;
    const legs = waypoints.flatMap((wp, index) => {
      const from = index === 0 ? effectiveStart : { lat: waypoints[index - 1].lat, lon: waypoints[index - 1].lon };
      const end = { lat: wp.lat, lon: wp.lon };
      const legKmh = MODE_DEFAULT_KMH[wp.mode] * factor;
      const base = { speed: legKmh, startTime: Date.now(), endTime: Date.now() + 60000 };

      // Travel leg(s) to this stop. Train follows the resolved rail geometry (if
      // a rail router gave one) by expanding into straight `flight` sub-legs.
      let travel;
      if (wp.mode === "train") {
        const geom = perLegSegments?.[index]?.coords ?? [from, end];
        const path = geom.length > 2 ? simplifyGeometry(geom, 60) : [from, end];
        travel = path.slice(0, -1).map((p, k) => ({ type: "flight", start: p, end: path[k + 1], ...base }));
      } else {
        travel = [{ type: BACKEND_LEG_TYPE[wp.mode], start: from, end, ...base }];
      }

      // Dwell at this stop (boarding / waiting for the next train), played as a
      // near-stationary wait — uses the computed schedule's wait (which already
      // folds in the real train wait), skipped on the final stop.
      const waitSeconds = index < lastIndex ? Math.round((schedule[index]?.wait ?? 0) * 60) : 0;
      return waitSeconds > 0 ? [...travel, makeWaitLeg(end, waitSeconds)] : travel;
    });

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

  return (
    <div className="map-tool-content">
      {/* Unified itinerary builder */}
      <details className="ui-card tool-section" open>
        <summary className="ui-card-title tool-section-summary">
          <MapPin size={16} /> Itinéraire
        </summary>

        {/* Start point — defaults to the live current position, overridable. */}
        <div className="form-group">
          <label className="form-label">Départ</label>
          {start ? (
            <div className="waypoint-item">
              <LocateFixed size={14} className="waypoint-grip" aria-hidden="true" />
              <span className="waypoint-name">{startName || `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}`}</span>
              <button
                className="icon-btn"
                onClick={() => {
                  setStart(null);
                  setStartName(null);
                }}
                aria-label="Repartir de ma position actuelle"
                title="Repartir de ma position actuelle"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <DestinationSearchInput
              placeholder="Ma position (par défaut) — choisir un autre départ"
              near={currentPos}
              onSelect={(lat, lon, name) => {
                setStart({ lat, lon });
                setStartName(name);
              }}
            />
          )}
        </div>

        {/* Departure time — drives the computed per-stop schedule. */}
        {waypoints.length > 0 && (
          <div className="form-group">
            <label className="form-label">Heure de départ</label>
            <input
              type="datetime-local"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
            />
          </div>
        )}

        {/* Shared ordered stop list — per-leg mode toggle on each row, plus an
            optional multi-select for bulk mode editing. */}
        {waypoints.length > 0 && (
          <>
            <div className="waypoint-toolbar">
              <span className="form-hint" style={{ margin: 0 }}>
                {waypoints.length} étape{waypoints.length > 1 ? "s" : ""}
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                {optimizeEligible && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={handleOptimize}
                    disabled={optimizing}
                    title="Réordonner les étapes pour le trajet le plus court"
                  >
                    <Wand2 size={13} /> {optimizing ? "..." : "Optimiser"}
                  </button>
                )}
                <button
                  type="button"
                  className={`mini-btn ${selecting ? "active" : ""}`}
                  onClick={() => {
                    setSelecting((v) => !v);
                    setSelected(new Set());
                  }}
                >
                  <CheckSquare size={13} /> {selecting ? "Terminer" : "Sélectionner"}
                </button>
              </div>
            </div>

            {selecting && selected.size > 0 && (
              <div className="waypoint-bulk-bar">
                <span>{selected.size} sélectionnée{selected.size > 1 ? "s" : ""} →</span>
                {MODE_ORDER.map((m) => {
                  const Icon = MODE_META[m].icon;
                  return (
                    <button key={m} type="button" className="mini-btn" onClick={() => applyModeToSelected(m)}>
                      <Icon size={13} /> {MODE_META[m].label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="waypoint-list">
              {waypoints.map((wp, index) => (
                <div className="waypoint-row" key={index}>
                <div
                  className={`waypoint-item ${draggedIndex === index ? "dragging" : ""} ${
                    selecting && selected.has(index) ? "selected" : ""
                  }`}
                  draggable={!selecting}
                  onDragStart={() => setDraggedIndex(index)}
                  onDragEnd={() => setDraggedIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null) reorderWaypoint(draggedIndex, index);
                    setDraggedIndex(null);
                  }}
                >
                  {selecting ? (
                    <input
                      type="checkbox"
                      className="waypoint-check"
                      checked={selected.has(index)}
                      onChange={() => toggleSelected(index)}
                      aria-label={`Sélectionner l'étape ${index + 1}`}
                    />
                  ) : (
                    <GripVertical size={14} className="waypoint-grip" aria-hidden="true" />
                  )}
                  <span className="waypoint-badge">{index + 1}</span>
                  <span className="waypoint-name">{wp.name}</span>

                  {/* Per-leg mode picker (hidden while bulk-selecting to keep the
                      row focused on selection). */}
                  {!selecting && (
                    <span className="waypoint-mode-picker">
                      {React.createElement(MODE_META[wp.mode].icon, { size: 14 })}
                      <select
                        className="waypoint-mode-select"
                        value={wp.mode}
                        onChange={(e) => setLegMode(index, e.target.value as LegMode)}
                        aria-label={`Mode de l'étape ${index + 1}`}
                      >
                        {MODE_ORDER.map((m) => (
                          <option key={m} value={m}>
                            {MODE_META[m].label}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}

                  <button
                    className="icon-btn"
                    onClick={() => removeWaypoint(index)}
                    aria-label={`Retirer l'étape ${index + 1} (${wp.name})`}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Computed schedule + dwell for this stop. When the NEXT leg is
                    a real train, the wait is the timetable wait (read-only). */}
                {!selecting && schedule[index] && (() => {
                  const nextIsTrain = !!segs?.[index + 1]?.transit;
                  const trainHere = schedule[index].label; // train arriving at this stop
                  return (
                    <div className="waypoint-schedule">
                      <Clock size={11} />
                      <span title="Heure d'arrivée">arr {fmtClock(schedule[index].arrival)}</span>
                      {trainHere && <span className="schedule-train">🚆 {trainHere}</span>}
                      {index < waypoints.length - 1 &&
                        (nextIsTrain ? (
                          <span title="Attente du prochain train">
                            · attente {schedule[index].wait} min · dép {fmtClock(schedule[index].departure)}
                          </span>
                        ) : (
                          <span className="waypoint-dwell">
                            ·
                            <input
                              type="number"
                              className="waypoint-dwell-input"
                              min={0}
                              max={600}
                              value={wp.waitMinutes ?? 0}
                              onChange={(e) => setLegWait(index, parseInt(e.target.value) || 0)}
                              aria-label={`Temps d'attente à l'étape ${index + 1} (minutes)`}
                            />
                            min d'attente
                            {(wp.waitMinutes ?? 0) > 0 && <> · dép {fmtClock(schedule[index].departure)}</>}
                          </span>
                        ))}
                    </div>
                  );
                })()}
                </div>
              ))}
            </div>
          </>
        )}

        {waypoints.length > 0 && (
          <div className="waypoint-estimate">
            {osrmLoading ? (
              <span>Calcul de l'itinéraire...</span>
            ) : (
              <>
                <span>
                  {isRealDistance ? "" : "≈ "}
                  {(estimatedMeters / 1000).toFixed(1)} km
                  {isRealDistance
                    ? selectedRoute?.estimated
                      ? " (estimé)"
                      : " (tracé réel)"
                    : " à vol d'oiseau"}
                </span>
                <span title="Temps estimé selon le type de route et le mode de transport">
                  ≈ {formatDuration(displayDurationSeconds)}
                  {timeIsEstimated && (
                    <span className="estimate-tag" title={estimateHint}>
                      estimé
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        )}

        {finalArrival && !osrmLoading && (
          <div className="waypoint-arrival">
            <Clock size={13} /> Arrivée estimée à {fmtClock(finalArrival)}
          </div>
        )}

        {/* Alternative routes (single-mode only) — selectable chips. */}
        {routeOptions.length > 1 && (
          <div className="alt-routes">
            {routeOptions.map((opt, i) => (
              <button
                key={i}
                type="button"
                className={`alt-route-chip ${i === selectedAlt ? "active" : ""}`}
                onClick={() => setSelectedAlt(i)}
              >
                <span className="alt-route-label">{i === 0 ? "Recommandé" : `Alt. ${i}`}</span>
                <span className="alt-route-meta">
                  {formatDuration(opt.duration)} · {(opt.distance / 1000).toFixed(1)} km
                </span>
              </button>
            ))}
          </div>
        )}

        {/* How to add a stop */}
        <div className="form-group">
          <label className="form-label">Ajouter une étape</label>
          <SegmentedToggle
            value={addMethod}
            onChange={(v) => setAddMethod(v as AddMethod)}
            options={[
              { id: "search", label: "Rechercher", icon: Search },
              { id: "map", label: "Sur la carte", icon: MousePointerClick },
              { id: "coords", label: "Coordonnées", icon: Hash },
            ]}
          />
        </div>

        {addMethod === "search" && (
          <DestinationSearchInput
            placeholder={waypoints.length === 0 ? "Choisir une destination..." : "Ajouter une étape..."}
            onSelect={addWaypoint}
            near={currentPos}
          />
        )}

        {addMethod === "map" && (
          <p className="form-hint" style={{ margin: 0 }}>
            Cliquez sur la carte pour ajouter une étape. Chaque clic l'ajoute à la
            fin de la liste ci-dessus.
          </p>
        )}

        {addMethod === "coords" && (
          <div className="form-group">
            <div className="search-group">
              <input
                type="text"
                placeholder="Latitude"
                value={coordLat}
                onChange={(e) => setCoordLat(e.target.value)}
              />
              <input
                type="text"
                placeholder="Longitude"
                value={coordLon}
                onChange={(e) => setCoordLon(e.target.value)}
              />
              <button className="btn btn-secondary" onClick={handleAddCoords}>
                Ajouter
              </button>
            </div>
            {coordError && <div className="field-error">{coordError}</div>}
          </div>
        )}

        {/* Shared launch controls */}
        {waypoints.length > 0 && (
          <>
            <div className="form-group">
              <label className="form-label">Éviter</label>
              <div className="avoid-toggles">
                <label className="avoid-chip">
                  <input type="checkbox" checked={excludeMotorway} onChange={(e) => setExcludeMotorway(e.target.checked)} />
                  <span>Autoroutes</span>
                </label>
                <label className="avoid-chip">
                  <input type="checkbox" checked={excludeToll} onChange={(e) => setExcludeToll(e.target.checked)} />
                  <span>Péages</span>
                </label>
                <label className="avoid-chip">
                  <input type="checkbox" checked={excludeFerry} onChange={(e) => setExcludeFerry(e.target.checked)} />
                  <span>Ferries</span>
                </label>
              </div>
              {usesPublicOsrm && excludeList.length > 0 && (
                <small className="form-hint">
                  Le serveur OSRM public ne garantit pas ces exclusions — utilisez un
                  serveur auto-hébergé pour un évitement fiable.
                </small>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Multiplicateur de vitesse (×)</label>
              <input type="number" min={0.1} step={0.1} value={speedFactor} onChange={(e) => setSpeedFactor(e.target.value)} />
              <small className="form-hint">
                Chaque tronçon se joue à la vitesse réaliste de son mode (voiture ~50,
                marche ~5, train ~120, avion ~800 km/h) multipliée par ce facteur.
              </small>
            </div>

            <label className="switch-label">
              <span className="form-label">Itinéraire en boucle</span>
              <span className="switch-control">
                <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} />
                <span className="switch-slider"></span>
              </span>
            </label>

            <button className="btn btn-success" onClick={handlePlay} disabled={!canSend}>
              <Play size={14} /> Lancer l'itinéraire
            </button>
          </>
        )}
      </details>

      {/* GPX track replay — separate, collapsed by default */}
      <details className="ui-card tool-section">
        <summary className="ui-card-title tool-section-summary">
          <Save size={16} /> Importation GPX
        </summary>
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
      </details>

      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
};
