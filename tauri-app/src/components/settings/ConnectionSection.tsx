import React from "react";
import { RefreshCw } from "lucide-react";
import { useEngine } from "../../context/websocket";
import type { SettingsForm } from "../../features/settings/useSettingsForm";

// Where the engine is and how to reach it: sidecar state, listening port, and
// which network interface gets announced over mDNS.
export const ConnectionSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { engineStatus, connectionUrl, mdnsInterface, setMdnsInterface, networkInterfaces } = useEngine();

  return (
    <div className="ui-card">
      <div className="info-grid">
        <div className="info-item">
          <span className="info-label">État du sidecar</span>
          <span className={`info-value ${engineStatus === "running" ? "green" : engineStatus === "crashed" ? "warning" : ""}`}>
            {engineStatus === "running" ? "En cours" : engineStatus === "starting" ? "Démarrage" : engineStatus === "crashed" ? "Planté" : "Inconnu"}
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">Endpoint actuel</span>
          <span className="info-value compact">{connectionUrl}</span>
        </div>
      </div>

      <fieldset className="field-group">
        <legend className="field-group-legend">Port du moteur</legend>
        <div className="form-group">
          <label className="form-label">Port d'écoute du moteur</label>
          <input
            type="number"
            value={form.enginePortInput}
            onChange={(e) => form.setEnginePortInput(e.target.value)}
          />
          {form.enginePortError && <span className="field-error">{form.enginePortError}</span>}
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={form.handleApplyEnginePort}>
            <RefreshCw size={14} /> Redémarrer le moteur sur ce port
          </button>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend className="field-group-legend">Découverte réseau (iOS)</legend>
        <div className="form-group">
          <label className="form-label">Carte réseau annoncée (découverte iOS)</label>
          <select value={mdnsInterface ?? ""} onChange={(e) => setMdnsInterface(e.target.value || null)}>
            <option value="">Toutes les interfaces (auto)</option>
            {networkInterfaces.map((iface) => (
              <option key={iface.name} value={iface.name}>
                {iface.name} ({iface.ip})
              </option>
            ))}
          </select>
          <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "6px 0 0" }}>
            Restreint l'adresse annoncée en mDNS à cette carte réseau — utile si plusieurs
            interfaces (Wi-Fi, Ethernet, VPN) sont actives et que l'app iOS découvre la
            mauvaise IP.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Appairage (iPhone / autre PC)</label>
          <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
            L'appairage se fait désormais depuis la section <strong>Accès distant</strong> :
            elle affiche un code à 6 chiffres et un QR Code à scanner depuis l'app iOS ou le
            navigateur d'un autre ordinateur.
          </p>
        </div>
      </fieldset>
    </div>
  );
};
