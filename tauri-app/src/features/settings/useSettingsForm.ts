import { useEffect, useState } from "react";
import { parseCoordinate } from "../../lib/parse";
import { getRailRouterUrl, setRailRouterUrl as persistRailRouterUrl } from "../../lib/osrm";
import { isTransitEnabled, setTransitEnabled as persistTransitEnabled } from "../../lib/transit";
import { useEngine } from "../../context/websocket";
import {
  DEFAULT_ROUTING_PRIORITY,
  ROUTING_PROVIDER_LABELS,
  buildSettingsPayload,
  isValidRsdAddress as validateRsdAddress,
  moveRoutingProviderPriority,
  selectQrPairingHost,
  type RoutingProviderId,
} from "./settingsModel";

// All of the settings modal's local state, in one place.
//
// SettingsModal used to hold this alongside eight blocks of JSX, which made it
// impossible to test any of it: checking that a malformed port is rejected, or
// that saving clears the API-key inputs, meant rendering the whole modal. The
// state and the presentation are now separable — the sections under
// components/settings/ read this through a single `form` prop and get the
// engine itself from the context directly.
//
// Values that live on the engine are *not* duplicated here; they are read from
// useEngine() by whichever section needs them. What this hook owns is only what
// the user is editing but has not saved yet.

export type SettingsForm = ReturnType<typeof useSettingsForm>;

export function useSettingsForm(open: boolean) {
  const {
    enginePort,
    setEnginePort,
    mdnsInterface,
    networkInterfaces,
    canSend,
    status,
    saveSettings,
    getDiagnostics,
    getNetworkDevices,
  } = useEngine();

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
  const qrPairingHost = selectQrPairingHost(networkInterfaces, mdnsInterface);

  // "ip:port" — accepts the format the daemon expects for a pinned RSD endpoint.
  const isValidRsdAddress = validateRsdAddress(wifiAddress);

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
    saveSettings(buildSettingsPayload({
      companionPort,
      preferredDriver,
      isEveilMode,
      eveilInterval,
      jitterEnabled,
      osrmBaseUrl,
      routingMode,
      routingProvider,
      routingPriority,
      googleRoutesApiKey,
      mapboxAccessToken,
      clusterHeartbeat,
      clusterMasterDead,
      clusterPeerTimeout,
    }));
    // The secrets are write-only: the engine never sends them back, so clearing
    // the inputs after a save is what makes the placeholder switch to "already
    // configured" rather than leaving the key sitting in the DOM.
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
      saveSettings({ googleRoutesApiKey: "" });
      setGoogleRoutesApiKey("");
    } else {
      saveSettings({ mapboxAccessToken: "" });
      setMapboxAccessToken("");
    }
    showToast("Cle supprimee du moteur.");
  };

  const moveRoutingProvider = (provider: RoutingProviderId, direction: -1 | 1) => {
    setRoutingPriority((current) => moveRoutingProviderPriority(current, provider, direction));
  };

  // The rail router and the Transitous toggle are browser-local: mirror each
  // change into localStorage as it happens, since there is no "Enregistrer"
  // round-trip to the engine to carry them.
  const setRailRouterUrl = (value: string) => {
    setRailRouterUrlState(value);
    persistRailRouterUrl(value);
  };

  const setTransitEnabled = (value: boolean) => {
    setTransitEnabledState(value);
    persistTransitEnabled(value);
  };

  // Provider availability as reported by the engine, with a local fallback so
  // the section still renders (OSRM only) before the first status arrives.
  const routingProviderInfos = status?.routing?.providers ?? DEFAULT_ROUTING_PRIORITY.map((id) => ({
    id,
    name: ROUTING_PROVIDER_LABELS[id],
    available: id === "osrm",
    configured: id === "osrm",
    profiles: ["driving", "walking", "cycling"] as const,
  }));
  const routingProviderInfoById = Object.fromEntries(routingProviderInfos.map((provider) => [provider.id, provider]));
  const activeRoutingProvider = status?.routing?.activeProvider ?? "osrm";

  return {
    toast,
    showToast,

    enginePortInput,
    setEnginePortInput,
    enginePortError,
    handleApplyEnginePort,

    companionPort,
    setCompanionPort,
    preferredDriver,
    setPreferredDriver,
    wifiAddress,
    setWifiAddress,
    selectedNetworkDeviceUdid,
    setSelectedNetworkDeviceUdid,
    isValidRsdAddress,

    isEveilMode,
    setIsEveilMode,
    eveilInterval,
    setEveilInterval,
    jitterEnabled,
    setJitterEnabled,

    osrmBaseUrl,
    setOsrmBaseUrl,
    routingMode,
    setRoutingMode,
    routingProvider,
    setRoutingProvider,
    routingPriority,
    moveRoutingProvider,
    googleRoutesApiKey,
    setGoogleRoutesApiKey,
    mapboxAccessToken,
    setMapboxAccessToken,
    clearRoutingSecret,
    railRouterUrl,
    setRailRouterUrl,
    transitEnabled,
    setTransitEnabled,
    routingProviderInfos,
    routingProviderInfoById,
    activeRoutingProvider,

    clusterHeartbeat,
    setClusterHeartbeat,
    clusterMasterDead,
    setClusterMasterDead,
    clusterPeerTimeout,
    setClusterPeerTimeout,

    handleSaveSettings,
    qrPairingHost,
  };
}
