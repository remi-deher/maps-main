import React from "react";
import { Activity, Pause, Play, RefreshCw, Square } from "lucide-react";
import { useEngine } from "../../context/websocket";
import type { SettingsForm } from "../../features/settings/useSettingsForm";
import { SaveSettingsButton } from "./SaveSettingsButton";

// Live simulation transport controls, plus the two behaviours that shape a run
// (keep-alive and speed jitter).
export const SimulationSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { canSend, status, relance, clearLocation, pauseRoute, resumeRoute, stopRoute } = useEngine();

  // Pause/Stop only make sense while something is actually playing.
  const isSimRunning = status?.state === "moving" || status?.state === "paused";

  return (
    <div className="ui-card">
      <h3 className="ui-card-title">
        <Activity size={16} /> Contrôle simulation
      </h3>
      <div className="control-actionbar">
        <button className="btn btn-secondary" onClick={relance} disabled={!canSend}>
          <RefreshCw size={14} /> Relancer
        </button>
        <button className="btn btn-danger" onClick={clearLocation} disabled={!canSend}>
          <Square size={14} /> Arrêter GPS
        </button>
      </div>
      {isSimRunning && (
        <div className="control-actionbar" style={{ marginTop: 8 }}>
          {status?.state === "paused" ? (
            <button className="btn btn-success" onClick={resumeRoute} disabled={!canSend}>
              <Play size={14} /> Reprendre
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={pauseRoute} disabled={!canSend}>
              <Pause size={14} /> Pause
            </button>
          )}
          <button className="btn btn-danger" onClick={stopRoute} disabled={!canSend}>
            <Square size={14} /> Stop
          </button>
        </div>
      )}

      <fieldset className="field-group" style={{ marginTop: 12 }}>
        <legend className="field-group-legend">Comportement de simulation</legend>

        <label className="switch-label">
          <span className="form-label">Mode Éveil</span>
          <span className="switch-control">
            <input
              type="checkbox"
              checked={form.isEveilMode}
              onChange={(e) => form.setIsEveilMode(e.target.checked)}
            />
            <span className="switch-slider"></span>
          </span>
        </label>

        <label className="switch-label">
          <span className="form-label">Variation de vitesse (jitter)</span>
          <span className="switch-control">
            <input
              type="checkbox"
              checked={form.jitterEnabled}
              onChange={(e) => form.setJitterEnabled(e.target.checked)}
            />
            <span className="switch-slider"></span>
          </span>
        </label>

        {form.isEveilMode && (
          <div className="form-group">
            <label className="form-label">Intervalle Éveil (secondes)</label>
            <input
              type="number"
              value={form.eveilInterval}
              onChange={(e) => form.setEveilInterval(e.target.value)}
            />
          </div>
        )}
      </fieldset>

      <SaveSettingsButton onSave={form.handleSaveSettings} />
    </div>
  );
};
