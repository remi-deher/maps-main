import React from "react";
import { CheckSquare, Clock, Wand2 } from "lucide-react";
import { StopRow } from "./StopRow";
import { MODE_ORDER, formatDuration, type Waypoint } from "../../features/routes/routeModel";
import { MODE_META } from "../../features/routes/routePresentation";
import type { ItineraryBuilder } from "../../features/routes/useItineraryBuilder";

const formatClock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// The ordered stop list and everything that reads off it: the toolbar, the bulk
// mode bar, the rows, the distance/duration estimate, the arrival time and the
// alternative-route chips. Renders nothing until there is at least one stop.
export const StopList: React.FC<{
  waypoints: Waypoint[];
  builder: ItineraryBuilder;
}> = ({ waypoints, builder }) => {
  if (waypoints.length === 0) return null;

  return (
    <>
      <div className="waypoint-toolbar">
        <span className="form-hint" style={{ margin: 0 }}>
          {waypoints.length} étape{waypoints.length > 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          {builder.optimizeEligible && (
            <button
              type="button"
              className="mini-btn"
              onClick={builder.handleOptimize}
              disabled={builder.optimizing}
              title="Réordonner les étapes pour le trajet le plus court"
            >
              <Wand2 size={13} /> {builder.optimizing ? "..." : "Optimiser"}
            </button>
          )}
          <button
            type="button"
            className={`mini-btn ${builder.selecting ? "active" : ""}`}
            onClick={builder.toggleSelecting}
          >
            <CheckSquare size={13} /> {builder.selecting ? "Terminer" : "Sélectionner"}
          </button>
        </div>
      </div>

      {builder.selecting && builder.selected.size > 0 && (
        <div className="waypoint-bulk-bar">
          <span>{builder.selected.size} sélectionnée{builder.selected.size > 1 ? "s" : ""} →</span>
          {MODE_ORDER.map((m) => {
            const Icon = MODE_META[m].icon;
            return (
              <button key={m} type="button" className="mini-btn" onClick={() => builder.applyModeToSelected(m)}>
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
            draggedIndex={builder.draggedIndex}
            selecting={builder.selecting}
            isSelected={builder.selected.has(index)}
            scheduleEntry={builder.schedule[index]}
            nextIsTrain={!!builder.segs?.[index + 1]?.transit}
            dragHandlers={builder.getDragHandlers(index, builder.selecting)}
            onToggleSelect={builder.toggleSelected}
            onRemove={builder.removeWaypoint}
            onSetMode={builder.setLegMode}
            onSetWaitMinutes={builder.setLegWait}
          />
        ))}
      </div>

      <div className="waypoint-estimate">
        {builder.osrmLoading ? (
          <span>Calcul de l'itinéraire...</span>
        ) : (
          <>
            <span>
              {builder.isRealDistance ? "" : "≈ "}
              {(builder.estimatedMeters / 1000).toFixed(1)} km
              {builder.isRealDistance
                ? builder.selectedRoute?.estimated
                  ? " (estimé)"
                  : " (tracé réel)"
                : " à vol d'oiseau"}
            </span>
            <span title="Temps estimé selon le type de route et le mode de transport">
              ≈ {formatDuration(builder.displayDurationSeconds)}
              {builder.timeIsEstimated && (
                <span className="estimate-tag" title={builder.estimateHint}>
                  estimé
                </span>
              )}
            </span>
          </>
        )}
      </div>

      {builder.finalArrival && !builder.osrmLoading && (
        <div className="waypoint-arrival">
          <Clock size={13} /> Arrivée estimée à {formatClock(builder.finalArrival)}
        </div>
      )}

      {/* Alternative routes (single-mode only) — selectable chips. */}
      {builder.routeOptions.length > 1 && (
        <div className="alt-routes">
          {builder.routeOptions.map((opt, i) => (
            <button
              key={i}
              type="button"
              className={`alt-route-chip ${i === builder.selectedAlt ? "active" : ""}`}
              onClick={() => builder.setSelectedAlt(i)}
            >
              <span className="alt-route-label">{i === 0 ? "Recommandé" : `Alt. ${i}`}</span>
              <span className="alt-route-meta">
                {formatDuration(opt.duration)} · {(opt.distance / 1000).toFixed(1)} km
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
};
