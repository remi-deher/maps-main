import React from "react";
import { RefreshCw, Smartphone } from "lucide-react";
import { useEngine } from "../../context/websocket";
import { usePairing } from "../../context/pairingContext";
import type { SettingsForm } from "../../features/settings/useSettingsForm";
import { ReadinessPanel } from "./ReadinessPanel";

// Everything needed to work out why a device isn't reachable: where the driver
// binaries are, what USB sees, which pairing records exist locally, and the
// three reset buttons.
export const DiagnosticsSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { canSend, diagnostics, getDiagnostics, restartTunnel, restartMdns, restartServices } = useEngine();
  const { pairResult, pairing, pairDevice } = usePairing();

  return (
    <div className="ui-card">
      <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0 0 12px 0" }}>
        Informations de dépannage pour la détection USB et la communication avec l'appareil.
      </p>

      <button
        className="btn btn-secondary"
        onClick={getDiagnostics}
        disabled={!canSend}
        style={{ marginBottom: "16px" }}
      >
        <RefreshCw size={14} /> Rafraîchir les diagnostics
      </button>

      {diagnostics ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* First, because it answers the question the rest only hints at. */}
          <ReadinessPanel readiness={diagnostics.readiness} />

          <fieldset className="field-group">
            <legend className="field-group-legend">Chemins des pilotes (PC)</legend>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">
                  go-ios (Natif){diagnostics.goIosVersion ? ` — v${diagnostics.goIosVersion}` : ""}
                </span>
                <span className="info-value compact" style={{ color: diagnostics.goIosError ? "#f87171" : "#4ade80" }}>
                  {diagnostics.goIosError ? "Non trouvé dans le PATH" : diagnostics.goIosPath || "Trouvé"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">
                  pymobiledevice3{diagnostics.pmd3Version ? ` — v${diagnostics.pmd3Version}` : ""}
                </span>
                <span className="info-value compact" style={{ color: diagnostics.pmd3Error ? "#f87171" : "#4ade80" }}>
                  {diagnostics.pmd3Error ? "Non trouvé dans le PATH" : diagnostics.pmd3Path || "Trouvé"}
                </span>
              </div>
            </div>
          </fieldset>

          <fieldset className="field-group">
            <legend className="field-group-legend">Périphériques USB détectés</legend>
            {diagnostics.usbDevices && diagnostics.usbDevices.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {diagnostics.usbDevices.map((dev, i) => (
                  <div key={i} className="info-grid" style={{ background: "rgba(30, 41, 59, 0.5)", padding: "8px", borderRadius: "6px" }}>
                    <div className="info-item">
                      <span className="info-label">Nom</span>
                      <span className="info-value compact">{dev.Name || "Appareil iOS"}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">UDID</span>
                      <span className="info-value compact" style={{ fontFamily: "monospace" }}>{dev.UDID}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
                {diagnostics.usbDevicesError ? `Erreur: ${diagnostics.usbDevicesError}` : "Aucun périphérique détecté en USB."}
              </p>
            )}
          </fieldset>

          <fieldset className="field-group">
            <legend className="field-group-legend">Certificats d'appairage locaux (Lockdown)</legend>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: "0 0 8px 0" }}>
              Dossier : <code style={{ fontFamily: "monospace" }}>{diagnostics.lockdownDir || "Inconnu"}</code>
            </p>
            {diagnostics.pairingRecords && diagnostics.pairingRecords.length > 0 ? (
              <div style={{ maxHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", border: "1px solid rgba(255, 255, 255, 0.05)", padding: "6px", borderRadius: "6px" }}>
                {diagnostics.pairingRecords.map((rec, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", padding: "6px", background: "rgba(30, 41, 59, 0.3)", borderRadius: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: "bold" }}>
                        {rec.deviceName || "Nom inconnu"}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                        {new Date(rec.modTime).toLocaleDateString()}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#64748b", fontFamily: "monospace" }}>
                      {rec.udid}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
                Aucun certificat d'appairage trouvé dans le dossier Lockdown.
              </p>
            )}
          </fieldset>

          {diagnostics.unpairedUsbDevices && diagnostics.unpairedUsbDevices.length > 0 && (
            <div
              style={{
                border: "1px solid rgba(251, 191, 36, 0.3)",
                background: "rgba(251, 191, 36, 0.08)",
                borderRadius: "8px",
                padding: "10px",
              }}
            >
              <p style={{ fontSize: "0.8rem", color: "#fbbf24", margin: "0 0 8px 0" }}>
                Appareil(s) branché(s) en USB sans certificat d'appairage :{" "}
                <code style={{ fontFamily: "monospace" }}>{diagnostics.unpairedUsbDevices.join(", ")}</code>.
                Le tunnel WiFi (iOS 17+) ne peut pas s'établir tant qu'il n'est pas pairé une
                première fois en USB.
              </p>
              <button
                className="btn btn-secondary"
                onClick={pairDevice}
                disabled={!canSend || pairing}
                aria-busy={pairing}
              >
                {pairing ? <RefreshCw size={14} className="spin-icon" /> : <Smartphone size={14} />}{" "}
                {pairing ? "En attente du prompt sur l'iPhone..." : "Pairer l'iPhone (USB)"}
              </button>
              {pairResult && (
                <p
                  style={{
                    fontSize: "0.78rem",
                    margin: "8px 0 0 0",
                    color: pairResult.ok ? "#4ade80" : "#f87171",
                  }}
                >
                  {pairResult.ok
                    ? "Pairing réussi — le tunnel WiFi devrait maintenant pouvoir s'établir."
                    : `Échec : ${pairResult.error || "erreur inconnue"}`}
                </p>
              )}
            </div>
          )}

          <fieldset className="field-group">
            <legend className="field-group-legend">Remise à plat &amp; Maintenance</legend>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: "0 0 10px 0" }}>
              Commandes de remise à zéro à utiliser en cas de problème de connexion persistant.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  restartTunnel();
                  form.showToast("Commande de redémarrage du tunnel envoyée.");
                }}
                disabled={!canSend}
              >
                Redémarrer le Tunnel
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  restartMdns();
                  form.showToast("Commande de redémarrage mDNS envoyée.");
                }}
                disabled={!canSend}
              >
                Redémarrer Bonjour/mDNS
              </button>
              <button
                className="btn btn-secondary"
                style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" }}
                type="button"
                onClick={() => {
                  if (window.confirm("Êtes-vous sûr de vouloir remettre à plat tous les services (tuer pymobiledevice3, redémarrer Bonjour et relancer le tunnel) ?")) {
                    restartServices();
                    form.showToast("Remise à plat complète des services lancée.");
                  }
                }}
                disabled={!canSend}
              >
                Remise à plat complète
              </button>
            </div>
          </fieldset>
        </div>
      ) : (
        <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
          {canSend ? "Récupération des diagnostics en cours..." : "Moteur hors ligne."}
        </p>
      )}
    </div>
  );
};
