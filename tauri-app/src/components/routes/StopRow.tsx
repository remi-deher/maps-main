import React from "react";
import { GripVertical, X, Clock } from "lucide-react";
import type { Waypoint, LegMode } from "../../features/routes/routeModel";
import { MODE_META, MODE_ORDER } from "../../features/routes/routePresentation";

function fmtClock(d: Date | undefined) {
  if (!d) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface StopRowProps {
  wp: Waypoint;
  index: number;
  isLast: boolean;
  draggedIndex: number | null;
  selecting: boolean;
  isSelected: boolean;
  scheduleEntry?: { label?: string; arrival?: Date; departure?: Date; wait?: number };
  nextIsTrain: boolean;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  onToggleSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onSetMode: (index: number, mode: LegMode) => void;
  onSetWaitMinutes: (index: number, minutes: number) => void;
}

export function StopRow({
  wp,
  index,
  isLast,
  draggedIndex,
  selecting,
  isSelected,
  scheduleEntry,
  nextIsTrain,
  dragHandlers,
  onToggleSelect,
  onRemove,
  onSetMode,
  onSetWaitMinutes,
}: StopRowProps) {
  const trainHere = scheduleEntry?.label;

  return (
    <div className="waypoint-row">
      <div
        className={`waypoint-item ${draggedIndex === index ? "dragging" : ""} ${
          selecting && isSelected ? "selected" : ""
        }`}
        {...dragHandlers}
      >
        {selecting ? (
          <input
            type="checkbox"
            className="waypoint-check"
            checked={isSelected}
            onChange={() => onToggleSelect(index)}
            aria-label={`Sélectionner l'étape ${index + 1}`}
          />
        ) : (
          <GripVertical size={14} className="waypoint-grip" aria-hidden="true" />
        )}
        <span className="waypoint-badge">{index + 1}</span>
        <span className="waypoint-name">{wp.name}</span>

        {!selecting && (
          <span className="waypoint-mode-picker">
            {React.createElement(MODE_META[wp.mode].icon, { size: 14 })}
            <select
              className="waypoint-mode-select"
              value={wp.mode}
              onChange={(e) => onSetMode(index, e.target.value as LegMode)}
              aria-label={`Mode de l'étape ${index + 1}`}
            >
              {MODE_ORDER.map((m: LegMode) => (
                <option key={m} value={m}>
                  {MODE_META[m].label}
                </option>
              ))}
            </select>
          </span>
        )}

        <button
          className="icon-btn"
          onClick={() => onRemove(index)}
          aria-label={`Retirer l'étape ${index + 1} (${wp.name})`}
        >
          <X size={14} />
        </button>
      </div>

      {!selecting && scheduleEntry && (
        <div className="waypoint-schedule">
          <Clock size={11} />
          <span title="Heure d'arrivée">arr {fmtClock(scheduleEntry.arrival)}</span>
          {trainHere && <span className="schedule-train">🚆 {trainHere}</span>}
          {!isLast &&
            (nextIsTrain ? (
              <span title="Attente du prochain train">
                · attente {scheduleEntry.wait} min · dép {fmtClock(scheduleEntry.departure)}
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
                  onChange={(e) => onSetWaitMinutes(index, parseInt(e.target.value) || 0)}
                  aria-label={`Temps d'attente à l'étape ${index + 1} (minutes)`}
                />
                min d'attente
                {(wp.waitMinutes ?? 0) > 0 && <> · dép {fmtClock(scheduleEntry.departure)}</>}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
