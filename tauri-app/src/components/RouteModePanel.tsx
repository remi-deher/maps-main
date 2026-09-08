import React, { useState } from "react";
import { MapPin } from "lucide-react";
import { LatLon } from "../context/websocket";
import { AddStopControls } from "./routes/AddStopControls";
import { GpxReplayPanel } from "./routes/GpxReplayPanel";
import { LaunchControls } from "./routes/LaunchControls";
import { StartPointFields } from "./routes/StartPointFields";
import { StopList } from "./routes/StopList";
import { useItineraryBuilder } from "../features/routes/useItineraryBuilder";
import type { AddMethod, RouteSegment, Waypoint } from "../features/routes/routeModel";

// Re-exported for the modules that still import these through the panel.
export type { AddMethod, LegMode, RouteSegment, Waypoint } from "../features/routes/routeModel";
export { makeWaypointId } from "../features/routes/routeModel";
export { MODE_META } from "../features/routes/routePresentation";
export { patchWithNearestPlace } from "../features/routes/routeEffects";

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
///
/// This file is the assembly only: the builder's state and rules live in
/// `useItineraryBuilder`, and each block of the form under `components/routes/`.
export const RouteModePanel: React.FC<RouteModePanelProps> = ({
  waypoints,
  setWaypoints,
  addMethod,
  setAddMethod,
  start,
  setStart,
  onRouteSegmentsChange,
}) => {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const builder = useItineraryBuilder({
    waypoints,
    setWaypoints,
    start,
    setStart,
    onRouteSegmentsChange,
    showToast,
  });

  return (
    <div className="map-tool-content">
      <details className="ui-card tool-section" open>
        <summary className="ui-card-title tool-section-summary">
          <MapPin size={16} /> Itinéraire
        </summary>

        <StartPointFields waypoints={waypoints} start={start} builder={builder} />
        <StopList waypoints={waypoints} builder={builder} />
        <AddStopControls
          waypoints={waypoints}
          addMethod={addMethod}
          setAddMethod={setAddMethod}
          builder={builder}
        />
        <LaunchControls waypoints={waypoints} builder={builder} />
      </details>

      <GpxReplayPanel showToast={showToast} />

      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
};
