import React from "react";
import { RefreshCw } from "lucide-react";
import { useEngine } from "../../context/websocket";
import { EngineAction } from "../../types/engineMessages";
import type { SettingsForm } from "../../features/settings/useSettingsForm";

// Which backend drives the tunnel, and which device it targets. The three
// targeting modes are mutually exclusive, which is why picking one clears the
// other below.
export const DriverSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { canSend, networkDevices, getNetworkDevices, sendMessage } = useEngine();

  return (
    <div className="ui-card">
      <fieldset className="field-group">
        <legend className="field-group-legend">Pilote &amp; tunnel</legend>

        <div className="form-group">
          <label className="form-label">Port RSD (annoté dans le statut)</label>
          <input
            type="number"
            value={form.companionPort}
            onChange={(e) => form.setCompanionPort(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Driver préféré</label>
          <select value={form.preferredDriver} onChange={(e) => form.setPreferredDriver(e.target.value)}>
            <option value="go-ios">go-ios (Natif)</option>
            <option value="pymobiledevice">pymobiledevice3 (Python)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Appareils découverts (mDNS / tunnel actif)</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <select
              value={form.selectedNetworkDeviceUdid}
              disabled={!networkDevices?.devices?.length}
              onChange={(e) => {
                // Pin the device by UDID (auto mode): the daemon keeps following
                // it across USB/WiFi. Clear any manual address so the two pinning
                // modes don't conflict.
                form.setSelectedNetworkDeviceUdid(e.target.value);
                form.setWifiAddress("");
              }}
            >
              <option value="">
                {networkDevices?.devices?.length ? "Choisir un appareil…" : "Aucun appareil découvert"}
              </option>
              {networkDevices?.devices?.map((d) => (
                <option key={d.udid} value={d.udid}>
                  {d.udid.slice(0, 8)}… — {d.address}:{d.port}
                </option>
              ))}
            </select>
            <button className="btn" type="button" disabled={!canSend} onClick={getNetworkDevices} title="Rechercher à nouveau">
              <RefreshCw size={14} />
            </button>
          </div>
          {networkDevices?.error && (
            <small className="form-hint">
              Découverte indisponible avec ce driver : {networkDevices.error}
            </small>
          )}
          <small className="form-hint">
            Découverts automatiquement (USB ou réseau mDNS/Bonjour) par le démon.
            Choisir un appareil l'épingle par UDID : le tunnel le suit ensuite
            automatiquement quand il passe de l'USB au WiFi.
          </small>
        </div>

        <div className="form-group">
          <label className="form-label">Adresse RSD manuelle (optionnel)</label>
          <input
            type="text"
            value={form.wifiAddress}
            placeholder="192.168.1.42:62078 — vide = auto"
            aria-invalid={form.wifiAddress.trim() !== "" && !form.isValidRsdAddress}
            onChange={(e) => {
              form.setWifiAddress(e.target.value);
              form.setSelectedNetworkDeviceUdid("");
            }}
          />
          {form.wifiAddress.trim() !== "" && !form.isValidRsdAddress && (
            <span className="field-error">Format attendu : adresse_ip:port (ex. 192.168.1.42:62078).</span>
          )}
          <small className="form-hint">
            Adresse RSD figée (pas de suivi dynamique), pour un endpoint réseau
            que le démon ne découvre pas seul. Laissez vide pour le mode auto.
          </small>
        </div>

        <button
          className="btn btn-secondary"
          disabled={!canSend || !form.isValidRsdAddress}
          onClick={() => {
            const trimmed = form.wifiAddress.trim();
            // Priority: a typed manual address pins a raw endpoint (wifi); else a
            // picked device pins by UDID (auto + follow); else plain auto.
            sendMessage(EngineAction.SwitchDriver, {
              driverId: form.preferredDriver,
              transport: trimmed ? "wifi" : "auto",
              wifiAddress: trimmed,
              targetUdid: trimmed ? "" : form.selectedNetworkDeviceUdid,
            });
            form.showToast("Changement de driver demandé, redémarrage du tunnel...");
          }}
        >
          <RefreshCw size={14} /> Appliquer et relancer le tunnel
        </button>
      </fieldset>
    </div>
  );
};
