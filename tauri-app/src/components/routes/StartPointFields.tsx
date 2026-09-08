import React from "react";
import { LocateFixed, X } from "lucide-react";
import { DestinationSearchInput } from "../DestinationSearchInput";
import type { LatLon } from "../../context/websocket";
import type { Waypoint } from "../../features/routes/routeModel";
import type { ItineraryBuilder } from "../../features/routes/useItineraryBuilder";

// Where the itinerary starts, and at what time. The start defaults to the live
// current position; picking one pins it until the itinerary is launched.
export const StartPointFields: React.FC<{
  waypoints: Waypoint[];
  start: LatLon | null;
  builder: ItineraryBuilder;
}> = ({ waypoints, start, builder }) => (
  <>
    <div className="form-group">
      <label className="form-label">Départ</label>
      {start ? (
        <div className="waypoint-item">
          <LocateFixed size={14} className="waypoint-grip" aria-hidden="true" />
          <span className="waypoint-name">
            {builder.startName || `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}`}
          </span>
          <button
            className="icon-btn"
            onClick={builder.clearStart}
            aria-label="Repartir de ma position actuelle"
            title="Repartir de ma position actuelle"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <DestinationSearchInput
          placeholder="Ma position (par défaut) — choisir un autre départ"
          near={builder.currentPos}
          onSelect={builder.chooseStart}
        />
      )}
    </div>

    {/* Departure time — drives the computed per-stop schedule. */}
    {waypoints.length > 0 && (
      <div className="form-group">
        <label className="form-label">Heure de départ</label>
        <input
          type="datetime-local"
          value={builder.departureTime}
          onChange={(e) => builder.setDepartureTime(e.target.value)}
        />
      </div>
    )}
  </>
);
