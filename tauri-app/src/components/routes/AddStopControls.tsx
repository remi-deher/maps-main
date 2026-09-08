import React from "react";
import { Hash, MousePointerClick, Search } from "lucide-react";
import { DestinationSearchInput } from "../DestinationSearchInput";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import type { AddMethod, Waypoint } from "../../features/routes/routeModel";
import type { ItineraryBuilder } from "../../features/routes/useItineraryBuilder";

// The three ways to append a stop — search, map click, manual coordinates —
// behind one segmented picker.
export const AddStopControls: React.FC<{
  waypoints: Waypoint[];
  addMethod: AddMethod;
  setAddMethod: (m: AddMethod) => void;
  builder: ItineraryBuilder;
}> = ({ waypoints, addMethod, setAddMethod, builder }) => (
  <>
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
        onSelect={builder.addWaypoint}
        near={builder.currentPos}
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
            value={builder.coordLat}
            onChange={(e) => builder.setCoordLat(e.target.value)}
          />
          <input
            type="text"
            placeholder="Longitude"
            value={builder.coordLon}
            onChange={(e) => builder.setCoordLon(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={builder.handleAddCoords}>
            Ajouter
          </button>
        </div>
        {builder.coordError && <div className="field-error">{builder.coordError}</div>}
      </div>
    )}
  </>
);
