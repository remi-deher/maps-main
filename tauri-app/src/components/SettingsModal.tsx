import React, { useEffect, useState } from "react";
import { Activity, Cable, Pause, Play, Plug, Save, RefreshCw, Route, Server, Settings, Smartphone, Square, Wifi } from "lucide-react";
import { useWebSocket } from "../context/websocket";
import { RemoteAccessSection } from "./RemoteAccessSection";
import { parseCoordinate } from "../lib/parse";
import { getRailRouterUrl, setRailRouterUrl as persistRailRouterUrl } from "../lib/osrm";
import { isTransitEnabled, setTransitEnabled as persistTransitEnabled } from "../lib/transit";
import { Modal } from "./ui/Modal";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type RoutingProviderId = "google" | "mapbox" | "osrm";

const ROUTING_PROVIDER_LABELS: Record<RoutingProviderId, string> = {
  google: "Google Routes",
  mapbox: "Mapbox",
  osrm: "OSRM",
};

const DEFAULT_ROUTING_PRIORITY: RoutingProviderId[] = ["google", "mapbox", "osrm"];

/// Réglages avancés du moteur (connexion, appareil, tunnel/driver, diagnostics),
/// regroupés dans une modale à sections plutôt qu'un onglet permanent de la sidebar.
export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
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
    relance,
    clearLocation,
    pauseRoute,
    resumeRoute,
    stopRoute,
  } = useWebSocket();

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const [enginePortInput, setEnginePortInput] = useState(String(enginePort));
  const [enginePortError, setEnginePortError] = useState("");

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
  const [routingMode, setRoutingMode] = useState<"auto" | "manual">("auto");
  const [routingProvider, setRoutingProvider] = useState<RoutingProviderId>("osrm");
  const [routingPriority, setRoutingPriority] = useState<RoutingProviderId[]>(DEFAULT_ROUTING_PRIORITY);
  const [googleRoutesApiKey, setGoogleRoutesApiKey] = useState("");
  const [mapboxAccessToken, setMapboxAccessToken] = useState("");
  // Frontend-only (localStorage): the engine never uses the rail router.
  const [railRouterUrl, setRailRouterUrlState] = useState(getRailRouterUrl());
  const [transitEnabled, setTransitEnabledState] = useState(isTransitEnabled());
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

  // "ip:port" — accepts the format the daemon expects for a pinned RSD endpoint.
  const RSD_ADDRESS_RE = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;
  const isValidRsdAddress = wifiAddress.trim() === "" || RSD_ADDRESS_RE.test(wifiAddress.trim());

  // Prefill the routing/cluster fields with the engine's live values whenever a
  // fresh status arrives. Also prefill the driver and transport fields once on startup.
  useEffect(() => {
    if (!status) return;
    if (status.osrmBaseUrl !== undefined) setOsrmBaseUrl(status.osrmBaseUrl);
    if (status.routing) {
      setRoutingMode(status.routing.mode);
      setRoutingProvider(status.routing.provider);
      setRoutingPriority(status.routing.priority?.length ? status.routing.priority : DEFAULT_ROUTING_PRIORITY);
    }
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
    if (!open || !canSend) return;
    getDiagnostics();
    getNetworkDevices();
  }, [open, canSend]);

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
    const routingSettings: Record<string, unknown> = {
      routingMode,
      routingProvider,
      routingProviderPriority: routingPriority,
    };
    if (googleRoutesApiKey.trim()) routingSettings.googleRoutesApiKey = googleRoutesApiKey.trim();
    if (mapboxAccessToken.trim()) routingSettings.mapboxAccessToken = mapboxAccessToken.trim();

    saveSettings({
      companionPort: parseInt(companionPort),
      preferredDriver: preferredDriver as any,
      isEveilMode,
      eveilInterval: parseInt(eveilInterval),
      jitterEnabled,
      osrmBaseUrl: osrmBaseUrl.trim(),
      ...routingSettings,
      clusterHeartbeatSeconds: parseInt(clusterHeartbeat) || 0,
      clusterMasterDeadSeconds: parseInt(clusterMasterDead) || 0,
      clusterPeerTimeoutSeconds: parseInt(clusterPeerTimeout) || 0,
    } as any);
    setGoogleRoutesApiKey("");
    setMapboxAccessToken("");
    showToast("Réglages envoyés au moteur.");
  };

  const clearRoutingSecret = (provider: "google" | "mapbox") => {
    if (!canSend) {
      showToast("Moteur hors ligne: cle non modifiee.");
      return;
    }
    if (provider === "google") {
      saveSettings({ googleRoutesApiKey: "" } as any);
      setGoogleRoutesApiKey("");
    } else {
      saveSettings({ mapboxAccessToken: "" } as any);
      setMapboxAccessToken("");
    }
    showToast("Cle supprimee du moteur.");
  };

  const moveRoutingProvider = (provider: RoutingProviderId, direction: -1 | 1) => {
    setRoutingPriority((current) => {
      const normalized = [...current];
      for (const id of DEFAULT_ROUTING_PRIORITY) {
        if (!normalized.includes(id)) normalized.push(id);
      }
      const index = normalized.indexOf(provider);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= normalized.length) return normalized;
      const next = [...normalized];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const connectionSection = (
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
          <input type="number" value={enginePortInput} onChange={(e) => setEnginePortInput(e.target.value)} />
          {enginePortError && <span className="field-error">{enginePortError}</span>}
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={handleApplyEnginePort}>
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

  const deviceSection = (
    <div className="ui-card">
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
  );

  const isSimRunning = status?.state === "moving" || status?.state === "paused";

  const simulationSection = (
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
            <input type="checkbox" checked={isEveilMode} onChange={(e) => setIsEveilMode(e.target.checked)} />
            <span className="switch-slider"></span>
          </span>
        </label>

        <label className="switch-label">
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
      </fieldset>

      <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }} disabled={!canSend}>
        <Save size={14} /> Enregistrer
      </button>
    </div>
  );

  const driverSection = (
    <div className="ui-card">
      <fieldset className="field-group">
        <legend className="field-group-legend">Pilote &amp; tunnel</legend>

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
            aria-invalid={wifiAddress.trim() !== "" && !isValidRsdAddress}
            onChange={(e) => {
              setWifiAddress(e.target.value);
              setSelectedNetworkDeviceUdid("");
            }}
          />
          {wifiAddress.trim() !== "" && !isValidRsdAddress && (
            <span className="field-error">Format attendu : adresse_ip:port (ex. 192.168.1.42:62078).</span>
          )}
          <small className="form-hint">
            Adresse RSD figée (pas de suivi dynamique), pour un endpoint réseau
            que le démon ne découvre pas seul. Laissez vide pour le mode auto.
          </small>
        </div>

        <button
          className="btn btn-secondary"
          disabled={!canSend || !isValidRsdAddress}
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
      </fieldset>
    </div>
  );

  const routingProviderInfos = status?.routing?.providers ?? DEFAULT_ROUTING_PRIORITY.map((id) => ({
    id,
    name: ROUTING_PROVIDER_LABELS[id],
    available: id === "osrm",
    configured: id === "osrm",
    profiles: ["driving", "walking", "cycling"] as const,
  }));
  const routingProviderInfoById = Object.fromEntries(routingProviderInfos.map((provider) => [provider.id, provider]));
  const activeRoutingProvider = status?.routing?.activeProvider ?? "osrm";

  const routingSection = (
    <div className="ui-card">
      <fieldset className="field-group">
        <legend className="field-group-legend">Routage</legend>
        <div className="form-group">
          <label className="form-label">Serveur de routage (OSRM)</label>
          <input
            type="text"
            value={osrmBaseUrl}
            placeholder="http://router.project-osrm.org"
            onChange={(e) => setOsrmBaseUrl(e.target.value)}
          />
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="form-label">Provider utilise actuellement</label>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Actif</span>
                  <span className="info-value green">{ROUTING_PROVIDER_LABELS[activeRoutingProvider]}</span>
                </div>
                {routingProviderInfos.map((provider) => (
                  <div className="info-item" key={provider.id}>
                    <span className="info-label">{provider.name}</span>
                    <span className={`info-value ${provider.available ? "green" : "warning"}`}>
                      {provider.available ? "Disponible" : provider.configured ? "Configure" : "Cle absente"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="form-label">Mode de selection</label>
              <select value={routingMode} onChange={(e) => setRoutingMode(e.target.value as "auto" | "manual")}>
                <option value="auto">Auto - ordre de priorite serveur</option>
                <option value="manual">Manuel - provider force</option>
              </select>
              <small className="form-hint">
                En auto, le moteur essaie les providers disponibles selon l'ordre ci-dessous.
              </small>
            </div>

            {routingMode === "manual" && (
              <div>
                <label className="form-label">Provider manuel</label>
                <select value={routingProvider} onChange={(e) => setRoutingProvider(e.target.value as RoutingProviderId)}>
                  {DEFAULT_ROUTING_PRIORITY.map((id) => (
                    <option key={id} value={id}>
                      {ROUTING_PROVIDER_LABELS[id]}{routingProviderInfoById[id]?.available ? "" : " (indisponible)"}
                    </option>
                  ))}
                </select>
                {!routingProviderInfoById[routingProvider]?.available && (
                  <small className="field-error">
                    Ce provider n'est pas disponible: le moteur retombera sur l'ordre auto.
                  </small>
                )}
              </div>
            )}

            <div>
              <label className="form-label">Priorite du mode auto</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {routingPriority.map((id, index) => (
                  <div key={id} className="info-item" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="info-label" style={{ minWidth: 24 }}>{index + 1}</span>
                    <span className="info-value compact" style={{ flex: 1 }}>
                      {ROUTING_PROVIDER_LABELS[id]}
                      {!routingProviderInfoById[id]?.available ? " - indisponible tant que la cle est absente" : ""}
                    </span>
                    <button className="btn btn-secondary" type="button" disabled={index === 0} onClick={() => moveRoutingProvider(id, -1)}>
                      Haut
                    </button>
                    <button className="btn btn-secondary" type="button" disabled={index === routingPriority.length - 1} onClick={() => moveRoutingProvider(id, 1)}>
                      Bas
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="form-label">Cle API Google Routes</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  value={googleRoutesApiKey}
                  placeholder={routingProviderInfoById.google?.configured ? "Cle deja configuree - laisser vide pour conserver" : "GOOGLE_MAPS_API_KEY"}
                  onChange={(e) => setGoogleRoutesApiKey(e.target.value)}
                />
                <button className="btn btn-secondary" type="button" disabled={!canSend || !routingProviderInfoById.google?.configured} onClick={() => clearRoutingSecret("google")}>
                  Effacer
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Token Mapbox</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  value={mapboxAccessToken}
                  placeholder={routingProviderInfoById.mapbox?.configured ? "Token deja configure - laisser vide pour conserver" : "MAPBOX_ACCESS_TOKEN"}
                  onChange={(e) => setMapboxAccessToken(e.target.value)}
                />
                <button className="btn btn-secondary" type="button" disabled={!canSend || !routingProviderInfoById.mapbox?.configured} onClick={() => clearRoutingSecret("mapbox")}>
                  Effacer
                </button>
              </div>
            </div>
          </div>
          <small className="form-hint">
            Serveur OSRM utilisé pour calculer les itinéraires. Laissez vide pour
            l'instance publique par défaut, ou indiquez votre serveur auto-hébergé
            (confidentialité, hors-ligne, limites de débit).
          </small>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend className="field-group-legend">Train — réglages locaux (navigateur)</legend>
        <div className="form-group">
          <label className="form-label">Routeur ferroviaire (optionnel)</label>
          <input
            type="text"
            value={railRouterUrl}
            placeholder="https://mon-osrm-rail.exemple"
            onChange={(e) => {
              setRailRouterUrlState(e.target.value);
              persistRailRouterUrl(e.target.value);
            }}
          />
          <small className="form-hint">
            Service compatible OSRM (ex. OSRM avec profil rail, ou BRouter) pour faire
            suivre les voies aux étapes en mode Train. Vide = train en ligne droite.
            Réglage local au navigateur (non transmis au moteur).
          </small>
        </div>

        <div className="form-group">
          <label className="switch-label">
            <span className="form-label">Horaires de train réels (Transitous)</span>
            <span className="switch-control">
              <input
                type="checkbox"
                checked={transitEnabled}
                onChange={(e) => {
                  setTransitEnabledState(e.target.checked);
                  persistTransitEnabled(e.target.checked);
                }}
              />
              <span className="switch-slider"></span>
            </span>
          </label>
          <small className="form-hint">
            Récupère vrais horaires, voies et nom du train pour les tronçons gare→gare
            (service public gratuit). Repli sur l'estimation si indisponible.
          </small>
        </div>
      </fieldset>

      <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }} disabled={!canSend}>
        <Save size={14} /> Enregistrer
      </button>
    </div>
  );

  const remoteSection = (
    <RemoteAccessSection enginePort={enginePort} qrPairingHost={qrPairingHost} />
  );

  const clusterSection = (
    <div className="ui-card">
      <fieldset className="field-group">
        <legend className="field-group-legend">Cluster — réglages avancés</legend>
        <div className="form-group">
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
      </fieldset>

      <button className="btn" onClick={handleSaveSettings} style={{ marginTop: "10px" }} disabled={!canSend}>
        <Save size={14} /> Enregistrer
      </button>
    </div>
  );

  const diagnosticsSection = (
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
        </div>
      ) : (
        <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: 0 }}>
          {canSend ? "Récupération des diagnostics en cours..." : "Moteur hors ligne."}
        </p>
      )}
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Réglages"
        sections={[
          { id: "connection", label: "Connexion", icon: Plug, content: connectionSection },
          { id: "device", label: "Appareil", icon: Smartphone, content: deviceSection },
          { id: "simulation", label: "Simulation", icon: Settings, content: simulationSection },
          { id: "driver", label: "Pilote & Tunnel", icon: Cable, content: driverSection },
          { id: "routing", label: "Routage", icon: Route, content: routingSection },
          { id: "remote", label: "Accès distant", icon: Wifi, content: remoteSection },
          { id: "cluster", label: "Cluster", icon: Server, content: clusterSection },
          { id: "diagnostics", label: "Diagnostics", icon: Activity, content: diagnosticsSection },
        ]}
      />

      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  );
};
