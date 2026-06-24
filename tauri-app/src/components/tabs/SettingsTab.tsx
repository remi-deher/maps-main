import React, { useEffect, useState } from "react";
import { Settings, RefreshCw, QrCode, Smartphone, Save, Activity } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWebSocket } from "../../context/websocket";
import { parseCoordinate } from "../../lib/parse";

interface SettingsTabProps {
  showToast: (message: string) => void;
}

/// Settings tab (engine connection, device info, engine configuration) +
/// the QR pairing modal, extracted from the Sidebar god-component.
export const SettingsTab: React.FC<SettingsTabProps> = ({ showToast }) => {
  const {
    enginePort,
    engineStatus,
    setEnginePort,
    mdnsInterface,
    setMdnsInterface,
    networkInterfaces,
    connectionUrl,
    canSend,
    status,
    deviceDetails,
    getDeviceInfo,
    saveSettings,
    sendMessage,
    diagnostics,
    getDiagnostics,
    networkDevices,
    getNetworkDevices,
    pairResult,
    pairing,
    pairDevice,
  } = useWebSocket();

  const [enginePortInput, setEnginePortInput] = useState(String(enginePort));
  const [enginePortError, setEnginePortError] = useState("");
  const [showQrCode, setShowQrCode] = useState(false);

  const [companionPort, setCompanionPort] = useState("8080");
  const [preferredDriver, setPreferredDriver] = useState("go-ios");
  // No more USB/WiFi/Auto picker: the tunnel daemon decides USB vs WiFi on its
  // own (it runs over a virtual adapter either way, so we can't tell from here
  // anyway — see ListNetworkDevices doc). "Auto" stays the only mode unless the
  // user picks a discovered network device or types a manual RSD address below,
  // in which case we target it directly.
  const [wifiAddress, setWifiAddress] = useState("");
  const [selectedNetworkDeviceUdid, setSelectedNetworkDeviceUdid] = useState("");
  const [isEveilMode, setIsEveilMode] = useState(true);
  const [eveilInterval, setEveilInterval] = useState("15");
  const [jitterEnabled, setJitterEnabled] = useState(true);
  const [osrmBaseUrl, setOsrmBaseUrl] = useState("");
  const [clusterHeartbeat, setClusterHeartbeat] = useState("10");
  const [clusterMasterDead, setClusterMasterDead] = useState("30");
  const [clusterPeerTimeout, setClusterPeerTimeout] = useState("3");
  const [hasInitialized, setHasInitialized] = useState(false);

  // Pick the interface the user restricted mDNS to, if any; otherwise the first
  // detected LAN interface — "localhost" would be useless in the QR code since
  // it's scanned by a *different* device (the iPhone).
  const qrPairingHost = networkInterfaces.find((iface) => iface.name === mdnsInterface)?.ip
    ?? networkInterfaces[0]?.ip
    ?? null;
  const qrPairingAddress = qrPairingHost ? `${qrPairingHost}:${enginePort}` : null;

  // Prefill the routing/cluster fields with the engine's live values whenever a
  // fresh status arrives. Also prefill the driver and transport fields once on startup.
  useEffect(() => {
    if (!status) return;
    if (status.osrmBaseUrl !== undefined) setOsrmBaseUrl(status.osrmBaseUrl);
    if (status.clusterHeartbeatSeconds) setClusterHeartbeat(String(status.clusterHeartbeatSeconds));
    if (status.clusterMasterDeadSeconds) setClusterMasterDead(String(status.clusterMasterDeadSeconds));
    if (status.clusterPeerTimeoutSeconds) setClusterPeerTimeout(String(status.clusterPeerTimeoutSeconds));

    if (!hasInitialized) {
      if (status.deviceInfo?.driver) {
        setPreferredDriver(status.deviceInfo.driver);
      } else if (status.usbDriver) {
        setPreferredDriver(status.usbDriver);
      }
      setHasInitialized(true);
    }
  }, [status, hasInitialized]);

  useEffect(() => {
    if (canSend) {
      getDiagnostics();
      getNetworkDevices();
    }
  }, [canSend]);

  const handleApplyEnginePort = async () => {
    const parsed = parseCoordinate(enginePortInput, 1, 65535);
    if (parsed === null) {
      setEnginePortError("Port invalide (1-65535).");
      return;
    }
    setEnginePortError("");
    await setEnginePort(parsed);
    showToast(`Moteur redémarré sur le port ${parsed}.`);
  };

  const handleSaveSettings = () => {
    if (!canSend) {
      showToast("Moteur hors ligne: réglages non envoyés.");
      return;
    }
    saveSettings({
      companionPort: parseInt(companionPort),
      preferredDriver: preferredDriver as any,
      isEveilMode,
      eveilInterval: parseInt(eveilInterval),
      jitterEnabled,
      osrmBaseUrl: osrmBaseUrl.trim(),
      clusterHeartbeatSeconds: parseInt(clusterHeartbeat) || 0,
      clusterMasterDeadSeconds: parseInt(clusterMasterDead) || 0,
      clusterPeerTimeoutSeconds: parseInt(clusterPeerTimeout) || 0,
    } as any);
    showToast("Réglages envoyés au moteur.");
  };

  return (
    <>
      <div className="ui-card">
        <h3 className="ui-card-title">
          <Settings size={16} /> Connexion au moteur
        </h3>

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

        <div className="form-group">
          <label className="form-label">Port d'écoute du moteur</label>
          <input type="number" value={enginePortInput} onChange={(e) => setEnginePortInput(e.target.value)} />
          {enginePortError && <span className="field-error">{enginePortError}</span>}
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={handleApplyEnginePort}>
            <RefreshCw size={14} /> Redémarrer le moteur sur ce port
          </button>
        </div>

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
          <label className="form-label">Appairage par QR Code</label>
          <button className="btn btn-secondary" disabled={!qrPairingAddress} onClick={() => setShowQrCode(true)}>
            <QrCode size={14} /> Afficher le QR Code
          </button>
          {!qrPairingAddress && (
            <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "6px 0 0" }}>
              Aucune interface réseau locale détectée — connectez-vous à un réseau Wi-Fi
              ou Ethernet pour générer un QR Code.
            </p>
          )}
        </div>
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Smartphone size={16} /> Infos appareil
        </h3>
        <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
          Disponible uniquement avec le driver go-ios pour le moment.
        </p>

        <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={getDeviceInfo} disabled={!canSend}>
          <RefreshCw size={14} /> Récupérer les infos
        </button>

        {deviceDetails && (
          deviceDetails.error ? (
            <div className="inline-alert" style={{ marginTop: 8 }}>{deviceDetails.error}</div>
          ) : (
            <div className="info-grid" style={{ marginTop: 8 }}>
              <div className="info-item">
                <span className="info-label">Nom</span>
                <span className="info-value compact">{deviceDetails.name || "—"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Modèle</span>
                <span className="info-value compact">{deviceDetails.productType || "—"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">iOS</span>
                <span className="info-value compact">{deviceDetails.productVersion || "—"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Numéro de série</span>
                <span className="info-value compact">{deviceDetails.serialNumber || "—"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Adresse WiFi</span>
                <span className="info-value compact">{deviceDetails.wifiAddress || "—"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Adresse tunnel</span>
                <span className="info-value compact">{deviceDetails.tunnelAddress || "—"}</span>
              </div>
            </div>
          )
        )}
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Settings size={16} /> Configuration moteur
        </h3>

        <div className="form-group">
          <label className="form-label">Port RSD (annoté dans le statut)</label>
          <input type="number" value={companionPort} onChange={(e) => setCompanionPort(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Driver préféré</label>
          <select value={preferredDriver} onChange={(e) => setPreferredDriver(e.target.value)}>
            <option value="go-ios">go-ios (Natif)</option>
            <option value="pymobiledevice">pymobiledevice3 (Python)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Appareils découverts (mDNS / tunnel actif)</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <select
              value={selectedNetworkDeviceUdid}
              disabled={!networkDevices?.devices?.length}
              onChange={(e) => {
                // Pin the device by UDID (auto mode): the daemon keeps following
                // it across USB/WiFi. Clear any manual address so the two pinning
                // modes don't conflict.
                setSelectedNetworkDeviceUdid(e.target.value);
                setWifiAddress("");
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
            value={wifiAddress}
            placeholder="192.168.1.42:62078 — vide = auto"
            onChange={(e) => {
              setWifiAddress(e.target.value);
              setSelectedNetworkDeviceUdid("");
            }}
          />
          <small className="form-hint">
            Adresse RSD figée (pas de suivi dynamique), pour un endpoint réseau
            que le démon ne découvre pas seul. Laissez vide pour le mode auto.
          </small>
        </div>

        <button
          className="btn"
          style={{ marginTop: "4px" }}
          disabled={!canSend}
          onClick={() => {
            const trimmed = wifiAddress.trim();
            // Priority: a typed manual address pins a raw endpoint (wifi); else a
            // picked device pins by UDID (auto + follow); else plain auto.
            sendMessage("SWITCH_DRIVER", {
              driverId: preferredDriver,
              transport: trimmed ? "wifi" : "auto",
              wifiAddress: trimmed,
              targetUdid: trimmed ? "" : selectedNetworkDeviceUdid,
            });
            showToast("Changement de driver demandé, redémarrage du tunnel...");
          }}
        >
          <RefreshCw size={14} /> Appliquer et relancer le tunnel
        </button>

        <label className="switch-label" style={{ margin: "8px 0" }}>
          <span className="form-label">Mode Éveil</span>
          <span className="switch-control">
            <input type="checkbox" checked={isEveilMode} onChange={(e) => setIsEveilMode(e.target.checked)} />
            <span className="switch-slider"></span>
          </span>
        </label>

        <label className="switch-label" style={{ margin: "8px 0" }}>
          <span className="form-label">Variation de vitesse (jitter)</span>
          <span className="switch-control">
            <input type="checkbox" checked={jitterEnabled} onChange={(e) => setJitterEnabled(e.target.checked)} />
            <span className="switch-slider"></span>
          </span>
        </label>

        {isEveilMode && (
          <div className="form-group">
            <label className="form-label">Intervalle Éveil (secondes)</label>
            <input type="number" value={eveilInterval} onChange={(e) => setEveilInterval(e.target.value)} />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Serveur de routage (OSRM)</label>
          <input
            type="text"
            value={osrmBaseUrl}
            placeholder="http://router.project-osrm.org"
            onChange={(e) => setOsrmBaseUrl(e.target.value)}
          />
          <small className="form-hint">
            Serveur OSRM utilisé pour calculer les itinéraires. Laissez vide pour
            l'instance publique par défaut, ou indiquez votre serveur auto-hébergé
            (confidentialité, hors-ligne, limites de débit).
          </small>
        </div>

        <details className="form-group" style={{ marginTop: "8px" }}>
          <summary className="form-label" style={{ cursor: "pointer" }}>
            Cluster — réglages avancés
          </summary>
          <div style={{ marginTop: "8px" }}>
            <label className="form-label">Battement de cœur (s)</label>
            <input type="number" min={1} value={clusterHeartbeat} onChange={(e) => setClusterHeartbeat(e.target.value)} />
            <label className="form-label" style={{ marginTop: "8px" }}>
              Délai avant bascule maître (s)
            </label>
            <input type="number" min={1} value={clusterMasterDead} onChange={(e) => setClusterMasterDead(e.target.value)} />
            <label className="form-label" style={{ marginTop: "8px" }}>
              Timeout requête pair (s)
            </label>
            <input type="number" min={1} value={clusterPeerTimeout} onChange={(e) => setClusterPeerTimeout(e.target.value)} />
            <small className="form-hint">
              Cadence de surveillance et seuil de reprise en haute disponibilité.
              Les valeurs par défaut conviennent à un réseau local ; augmentez-les
              pour un lien distant à forte latence.
            </small>
          </div>
        </details>

        <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }} disabled={!canSend}>
          <Save size={14} /> Enregistrer
        </button>
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Activity size={16} /> Outils de diagnostic
        </h3>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <h4 style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: "0 0 6px 0", fontWeight: "semibold" }}>
                Chemins des pilotes (PC)
              </h4>
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
            </div>

            <div>
              <h4 style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: "0 0 6px 0", fontWeight: "semibold" }}>
                Périphériques USB détectés
              </h4>
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
            </div>

            <div>
              <h4 style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: "0 0 6px 0", fontWeight: "semibold" }}>
                Certificats d'appairage locaux (Lockdown)
              </h4>
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
            </div>

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
                >
                  <Smartphone size={14} /> {pairing ? "En attente du prompt sur l'iPhone..." : "Pairer l'iPhone (USB)"}
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
          </div>
        ) : (
          <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
            {canSend ? "Récupération des diagnostics en cours..." : "Moteur hors ligne."}
          </p>
        )}
      </div>

      {showQrCode && qrPairingAddress && (
        <div className="qr-overlay" role="dialog" aria-modal="true" onClick={() => setShowQrCode(false)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-card-title" style={{ margin: 0 }}>
              <QrCode size={16} /> Appairer un iPhone
            </h3>
            <div className="qr-modal-code">
              <QRCodeSVG value={qrPairingAddress} size={200} />
            </div>
            <p style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: 0 }}>
              Dans l'app iOS, ouvrez les réglages puis scannez ce code pour vous connecter
              directement à <strong>{qrPairingAddress}</strong>.
            </p>
            <button className="btn btn-secondary" onClick={() => setShowQrCode(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
};
