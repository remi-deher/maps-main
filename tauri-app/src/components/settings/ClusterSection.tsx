import React from "react";
import type { SettingsForm } from "../../features/settings/useSettingsForm";
import { SaveSettingsButton } from "./SaveSettingsButton";

// High-availability timings. Nothing here is safe to guess for the user: the
// right values depend on the link between the nodes, hence the hint.
export const ClusterSection: React.FC<{ form: SettingsForm }> = ({ form }) => (
  <div className="ui-card">
    <fieldset className="field-group">
      <legend className="field-group-legend">Cluster — réglages avancés</legend>
      <div className="form-group">
        <label className="form-label">Battement de cœur (s)</label>
        <input
          type="number"
          min={1}
          value={form.clusterHeartbeat}
          onChange={(e) => form.setClusterHeartbeat(e.target.value)}
        />
        <label className="form-label" style={{ marginTop: "8px" }}>
          Délai avant bascule maître (s)
        </label>
        <input
          type="number"
          min={1}
          value={form.clusterMasterDead}
          onChange={(e) => form.setClusterMasterDead(e.target.value)}
        />
        <label className="form-label" style={{ marginTop: "8px" }}>
          Timeout requête pair (s)
        </label>
        <input
          type="number"
          min={1}
          value={form.clusterPeerTimeout}
          onChange={(e) => form.setClusterPeerTimeout(e.target.value)}
        />
        <small className="form-hint">
          Cadence de surveillance et seuil de reprise en haute disponibilité.
          Les valeurs par défaut conviennent à un réseau local ; augmentez-les
          pour un lien distant à forte latence.
        </small>
      </div>
    </fieldset>

    <SaveSettingsButton onSave={form.handleSaveSettings} />
  </div>
);
