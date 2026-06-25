import React from "react";
import { Smartphone, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useWebSocket } from "../context/websocket";
import { Modal } from "./ui/Modal";
import { invoke } from "@tauri-apps/api/core";

interface DeviceModalProps {
  open: boolean;
  onClose: () => void;
}

/// Device status and remote enroller utility.
export const DeviceModal: React.FC<DeviceModalProps> = ({ open, onClose }) => {
  const { status } = useWebSocket();
  const [targetServer, setTargetServer] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = React.useState(false);

  const handleExport = async () => {
    if (!status?.deviceInfo?.udid || !targetServer) return;
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);

    try {
      // 1. Lire le certificat de pairage localement via la commande Rust
      const base64Plist = await invoke<string>("read_device_plist", {
        udid: status.deviceInfo.udid
      });

      // 2. Préparer l'URL cible
      let baseUrl = targetServer.trim();
      if (!baseUrl.startsWith("http")) {
        baseUrl = `http://${baseUrl}`;
      }
      if (!baseUrl.includes(":", 6)) {
        baseUrl = `${baseUrl}:8080`;
      }

      // 3. Envoyer au serveur cible (essayer /api/device/enroll puis /api/enroll)
      const payload = {
        udid: status.deviceInfo.udid,
        deviceRecord: base64Plist
      };

      const sendPost = async (url: string) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(`Erreur HTTP: ${response.status}`);
        }
        return response;
      };

      try {
        await sendPost(`${baseUrl}/api/device/enroll`);
      } catch (err) {
        console.log("Échec sur /api/device/enroll, tentative de repli sur /api/enroll...", err);
        await sendPost(`${baseUrl}/api/enroll`);
      }

      setExportSuccess(true);
    } catch (err: any) {
      setExportError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Périphérique">
      <div className="ui-card">
        <div className="command-panel-header">
          <div>
            <span className="section-kicker">Device</span>
            <h2>
              <Smartphone size={17} /> Périphérique
            </h2>
          </div>
          <span className="state-pill">{status?.deviceInfo ? "détecté" : "aucun"}</span>
        </div>
        {status?.deviceInfo ? (
          <>
            <div className="field-row-list" style={{ marginBottom: 20 }}>
              <div><span>Nom</span><strong>{status.deviceInfo.name}</strong></div>
              <div><span>Driver</span><strong>{status.deviceInfo.driver}</strong></div>
              <div><span>Transport</span><strong>{status.connectionType}</strong></div>
              <div><span>UDID</span><strong style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>{status.deviceInfo.udid}</strong></div>
            </div>

            <fieldset className="field-group" style={{ marginTop: 15 }}>
              <legend className="field-group-legend">Enrôlement à distance</legend>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Adresse du serveur Moteur cible</label>
                <input 
                  type="text" 
                  value={targetServer} 
                  onChange={(e) => setTargetServer(e.target.value)}
                  placeholder="192.168.1.143" 
                  style={{ width: "100%" }}
                />
                <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: "6px 0 0" }}>
                  Permet de transférer les certificats de confiance locaux vers un moteur distant (ex: Docker headless, NAS).
                </p>
              </div>

              <button 
                className="btn btn-primary" 
                style={{ width: "100%", justifyContent: "center", display: "flex", gap: 8 }}
                onClick={handleExport}
                disabled={exporting || !targetServer}
              >
                {exporting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                Transférer les certificats
              </button>

              {exportSuccess && (
                <div className="inline-alert success" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: "0.82rem" }}>
                  <CheckCircle2 size={14} /> Certificats transférés avec succès !
                </div>
              )}

              {exportError && (
                <div className="inline-alert error" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: "0.82rem" }}>
                  <AlertTriangle size={14} /> {exportError}
                </div>
              )}
            </fieldset>
          </>
        ) : (
          <div className="empty-state compact">Aucun appareil connecté.</div>
        )}
      </div>
    </Modal>
  );
};
