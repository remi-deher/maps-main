import React, { useEffect, useMemo, useState } from "react";
import {
  Save,
  Play,
  MapPin,
  X,
  Search,
  MousePointerClick,
  Hash,
  CheckSquare,
  LocateFixed,
  Wand2,
  Clock,
} from "lucide-react";
import { LatLon, useEngine } from "../context/websocket";
import { parseCoordinate } from "../lib/parse";
import { PlaceKind } from "../lib/geocoding";
import {
  osrmBaseUrl,
  fetchOptimizedStopOrder,
  getRailRouterUrl,
} from "../lib/osrm";
import { DestinationSearchInput } from "./DestinationSearchInput";
import { StopRow } from "./routes/StopRow";
import { useRouteDragAndDrop } from "../features/routes/useRouteDragAndDrop";
import {
  buildPlaybackLegs,
  calculateFallbackDurationSeconds,
  calculateHaversineTotal,
  calculateStopSchedule,
  resolveRouteOptions,
} from "../features/routes/routePlanner";
import {
  defaultDwellMinutes,
  formatDuration,
  isRoadRoutable,
  makeWaypointId,
  MODE_ORDER,
  OSRM_PROFILE,
  suggestLegMode,
  type AddMethod,
  type LegMode,
  type RouteOption,
  type RouteSegment,
  type Waypoint,
} from "../features/routes/routeModel";
import { autoModeToast, MODE_META } from "../features/routes/routePresentation";
import { patchWithNearestPlace } from "../features/routes/routeEffects";

export type { AddMethod, LegMode, RouteSegment, Waypoint } from "../features/routes/routeModel";
export { makeWaypointId } from "../features/routes/routeModel";
export { MODE_META } from "../features/routes/routePresentation";
export { patchWithNearestPlace } from "../features/routes/routeEffects";

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
  const { canSend, status, playCustomGpx, playSequence } = useEngine();

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

  // Resolve the route through the shared route planner. The component owns
  // only UI state; transport-specific resolution lives under features/routes.
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
                <StopRow
                  key={wp.id}
                  wp={wp}
                  index={index}
                  isLast={index === waypoints.length - 1}
                  draggedIndex={draggedIndex}
                  selecting={selecting}
                  isSelected={selected.has(index)}
                  scheduleEntry={schedule[index]}
                  nextIsTrain={!!segs?.[index + 1]?.transit}
                  dragHandlers={getDragHandlers(index, selecting)}
                  onToggleSelect={toggleSelected}
                  onRemove={removeWaypoint}
                  onSetMode={setLegMode}
                  onSetWaitMinutes={setLegWait}
                />
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
