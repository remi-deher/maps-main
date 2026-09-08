import React from "react";
import { Play } from "lucide-react";
import { useEngine } from "../../context/websocket";
import type { Waypoint } from "../../features/routes/routeModel";
import type { ItineraryBuilder } from "../../features/routes/useItineraryBuilder";

// What to avoid, how fast to play it, whether to loop — and the launch button.
// Hidden until there is something to launch.
export const LaunchControls: React.FC<{
  waypoints: Waypoint[];
  builder: ItineraryBuilder;
}> = ({ waypoints, builder }) => {
  const { canSend } = useEngine();
  if (waypoints.length === 0) return null;

  return (
    <>
      <div className="form-group">
        <label className="form-label">Éviter</label>
        <div className="avoid-toggles">
          <label className="avoid-chip">
            <input
              type="checkbox"
              checked={builder.excludeMotorway}
              onChange={(e) => builder.setExcludeMotorway(e.target.checked)}
            />
            <span>Autoroutes</span>
          </label>
          <label className="avoid-chip">
            <input
              type="checkbox"
              checked={builder.excludeToll}
              onChange={(e) => builder.setExcludeToll(e.target.checked)}
            />
            <span>Péages</span>
          </label>
          <label className="avoid-chip">
            <input
              type="checkbox"
              checked={builder.excludeFerry}
              onChange={(e) => builder.setExcludeFerry(e.target.checked)}
            />
            <span>Ferries</span>
          </label>
        </div>
        {builder.usesPublicOsrm && builder.excludeList.length > 0 && (
          <small className="form-hint">
            Le serveur OSRM public ne garantit pas ces exclusions — utilisez un
            serveur auto-hébergé pour un évitement fiable.
          </small>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Multiplicateur de vitesse (×)</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={builder.speedFactor}
          onChange={(e) => builder.setSpeedFactor(e.target.value)}
        />
        <small className="form-hint">
          Chaque tronçon se joue à la vitesse réaliste de son mode (voiture ~50,
          marche ~5, train ~120, avion ~800 km/h) multipliée par ce facteur.
        </small>
      </div>

      <label className="switch-label">
        <span className="form-label">Itinéraire en boucle</span>
        <span className="switch-control">
          <input
            type="checkbox"
            checked={builder.looping}
            onChange={(e) => builder.setLooping(e.target.checked)}
          />
          <span className="switch-slider"></span>
        </span>
      </label>

      <button className="btn btn-success" onClick={builder.handlePlay} disabled={!canSend}>
        <Play size={14} /> Lancer l'itinéraire
      </button>
    </>
  );
};
