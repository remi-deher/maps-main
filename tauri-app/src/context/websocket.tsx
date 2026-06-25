import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isTauri,
  sameOriginWsUrl,
  sameOriginHttpUrl,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from "../lib/runtime";

const DEFAULT_PORT = 8080;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Favorite {
  lat: number;
  lon: number;
  name: string;
  timestamp?: number;
}

export interface Settings {
  companionPort?: number;
  connectionMode?: "usb" | "wifi" | "both";
  operationMode?: "hybrid" | "client-server" | "autonomous";
  isEveilMode?: boolean;
  eveilInterval?: number;
  preferredDriver?: string;
  usbDriver?: string;
  wifiDriver?: string;
  fallbackEnabled?: boolean;
  clusterMode?: "off" | "manual" | "auto";
  clusterHeartbeatSeconds?: number;
  clusterMasterDeadSeconds?: number;
  clusterPeerTimeoutSeconds?: number;
  osrmBaseUrl?: string;
  logLevel?: string;
  notificationsEnabled?: boolean;
  dynamicIslandEnabled?: boolean;
}

export interface DeviceDetails {
  udid?: string;
  name?: string;
  productType?: string;
  productVersion?: string;
  serialNumber?: string;
  wifiAddress?: string;
  tunnelAddress?: string;
  error?: string;
}

export interface DeviceInfo {
  udid: string;
  name: string;
  driver: string;
}

export interface PairingRecord {
  udid: string;
  deviceName: string;
  modTime: number;
}

export interface DiagnosticsDevice {
  UDID: string;
  Name: string;
  Source: string;
}

export interface Diagnostics {
  goIosPath: string;
  goIosError?: string;
  goIosVersion?: string;
  pmd3Path: string;
  pmd3Error?: string;
  pmd3Version?: string;
  lockdownDir: string;
  pairingRecords: PairingRecord[] | null;
  usbDevices: DiagnosticsDevice[] | null;
  usbDevicesError?: string;
  // UDIDs of USB-connected devices with no Lockdown trust certificate yet —
  // the iOS 17+ WiFi RSD tunnel cannot come up for them until paired over
  // USB (see docs/IOS_PAIRING_TUNNEL.md). null/undefined on older engines
  // that predate this field.
  unpairedUsbDevices?: string[] | null;
  error?: string;
}

export interface PairResult {
  ok: boolean;
  error?: string;
}

export interface NavigationProgress {
  index: number;
  total: number;
  lat: number;
  lon: number;
  speed: number;
}

export interface NavigationStatus {
  state: "running" | "paused" | "stopped";
  index: number;
  total: number;
}

export interface Navigation {
  progress: NavigationProgress | null;
  status: NavigationStatus | null;
}

export interface PatrolZone {
  type: "circle" | "rectangle";
  center: LatLon;
  radius: number;
  bounds?: {
    ne: LatLon;
    sw: LatLon;
  };
  active: boolean;
}

export interface Status {
  state: "idle" | "ready" | "starting" | "running" | "moving" | "paused";
  tunnelActive: boolean;
  rsdAddress: string | null;
  rsdPort: number | null;
  connectionType: "USB" | "WiFi" | "MANUAL" | "UNKNOWN";
  deviceInfo: DeviceInfo | null;
  maintainActive: boolean;
  lastHeartbeat: number | null;
  usbDriver: string;
  wifiDriver: string;
  fallbackEnabled: boolean;
  notificationsEnabled: boolean;
  dynamicIslandEnabled: boolean;
  favorites: Favorite[];
  recentHistory: Favorite[];
  currentSequencePreview: LatLon[];
  patrolZone: PatrolZone | null;
  navigation: Navigation;
  lastInjectedLocation?: { lat: number; lon: number; name?: string; timestamp?: number } | null;
  lastRealLocation?: { lat: number; lon: number; drift?: number; timestamp?: number } | null;
  osrmBaseUrl?: string;
  clusterHeartbeatSeconds?: number;
  clusterMasterDeadSeconds?: number;
  clusterPeerTimeoutSeconds?: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
}

export interface NetworkDevice {
  udid: string;
  address: string;
  port: number;
}

export interface NetworkDevicesResult {
  devices: NetworkDevice[] | null;
  error?: string;
}

export interface Telemetry {
  latency: number;
  packetLoss: number;
  uptime: number;
  throughput: number;
}

export interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  source: string;
  category?: string;
  action?: string;
  message: string;
  fields?: Record<string, string>;
}

interface WebSocketContextType {
  isConnected: boolean;
  connectionStatus: "connecting" | "connected" | "reconnecting" | "disconnected";
  connectionUrl: string;
  enginePort: number;
  engineStatus: "starting" | "running" | "crashed" | "unknown";
  setEnginePort: (port: number) => Promise<void>;
  mdnsInterface: string | null;
  setMdnsInterface: (interfaceName: string | null) => Promise<void>;
  networkInterfaces: NetworkInterfaceInfo[];
  lastError: string | null;
  canSend: boolean;
  status: Status | null;
  telemetry: Telemetry | null;
  deviceDetails: DeviceDetails | null;
  logs: LogEntry[];
  getDeviceInfo: () => void;
  sendMessage: (type: string, data?: any) => boolean;
  setLocation: (lat: number, lon: number, name?: string) => void;
  clearLocation: () => void;
  playRoute: (endLat: number, endLon: number, speed: number, profile: "driving" | "walking" | "cycling") => void;
  playSequence: (legs: any[], looping: boolean) => void;
  playCustomGpx: (gpxContent: string, speed: number) => void;
  stopRoute: () => void;
  pauseRoute: () => void;
  resumeRoute: () => void;
  relance: () => void;
  saveSettings: (settings: Settings) => void;
  addFavorite: (lat: number, lon: number, name: string) => void;
  removeFavorite: (lat: number, lon: number) => void;
  renameFavorite: (lat: number, lon: number, newName: string) => void;
  updatePatrolZone: (zone: PatrolZone | null) => void;
  diagnostics: Diagnostics | null;
  getDiagnostics: () => void;
  networkDevices: NetworkDevicesResult | null;
  getNetworkDevices: () => void;
  pairResult: PairResult | null;
  pairing: boolean;
  pairDevice: () => void;
  // Remote-access pairing (browser mode): when the engine is reached from
  // another machine, the client must redeem the desktop's rotating code once to
  // obtain a durable token. needsPairing is true until that happens; submitCode
  // performs the exchange; forgetPairing drops the stored token to start over.
  needsPairing: boolean;
  pairCodeError: string | null;
  prefillCode: string | null;
  submitCode: (code: string, label?: string) => Promise<boolean>;
  forgetPairing: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
};

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enginePort, setEnginePortState] = useState(DEFAULT_PORT);
  const [engineStatus, setEngineStatus] = useState<WebSocketContextType["engineStatus"]>("unknown");
  const [mdnsInterface, setMdnsInterfaceState] = useState<string | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  // Remote-access pairing state (browser mode only). In Tauri the window talks
  // to its sidecar over loopback, which the engine always trusts, so pairing is
  // never required there.
  const [deviceToken, setDeviceToken] = useState<string | null>(() => (isTauri ? null : getStoredToken()));
  const [needsPairing, setNeedsPairing] = useState(false);
  const [pairCodeError, setPairCodeError] = useState<string | null>(null);
  const [prefillCode, setPrefillCode] = useState<string | null>(null);

  // Tauri: the engine runs as a localhost sidecar on the configured port (no
  // token — loopback is trusted). Browser: same origin as the served page, with
  // the durable device token appended so the engine authorizes the connection.
  const connectionUrl = isTauri
    ? `ws://localhost:${enginePort}/ws`
    : sameOriginWsUrl("/ws") + (deviceToken ? `?token=${encodeURIComponent(deviceToken)}` : "");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketContextType["connectionStatus"]>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevicesResult | null>(null);
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [pairing, setPairing] = useState(false);
  const maxLogEntries = 200;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      // Detach handlers before closing: otherwise the replaced socket's own
      // onclose fires and schedules an orphaned reconnect that later closes
      // the new, healthy connection — a self-sustaining reconnect loop.
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
    }

    console.log(`Connecting to GPS-Mock engine WebSocket on port ${enginePort}...`);
    setConnectionStatus((previous) => (previous === "disconnected" ? "reconnecting" : "connecting"));
    const ws = new WebSocket(connectionUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected successfully");
      setIsConnected(true);
      setConnectionStatus("connected");
      setLastError(null);
      // In browser mode there's no sidecar lifecycle to listen to, so a live
      // WebSocket is our proof the engine is up.
      if (!isTauri) {
        setEngineStatus("running");
      }
      // Request initial status and log buffer
      ws.send(JSON.stringify({ type: "GET_STATUS" }));
      ws.send(JSON.stringify({ type: "GET_LOGS" }));
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const { type, data } = envelope;

        switch (type) {
          case "STATUS":
          case "STATUS_UPDATE":
            setStatus(data);
            break;
          case "TELEMETRY":
            setTelemetry(data);
            break;
          case "DEVICE_INFO":
            setDeviceDetails(data);
            break;
          case "LOG":
            setLogs((prev) => {
              const next = [...prev, data as LogEntry];
              return next.length > maxLogEntries ? next.slice(next.length - maxLogEntries) : next;
            });
            break;
          case "DIAGNOSTICS":
            setDiagnostics(data);
            break;
          case "NETWORK_DEVICES":
            setNetworkDevices(data);
            break;
          case "PAIR_RESULT":
            setPairResult(data);
            setPairing(false);
            break;
          case "LOGS":
            setLogs((Array.isArray(data) ? data : []) as LogEntry[]);
            break;
          case "LOCATION":
            // Can update location inside status if necessary
            if (status) {
              setStatus((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  navigation: {
                    ...prev.navigation,
                    progress: prev.navigation.progress ? {
                      ...prev.navigation.progress,
                      lat: data.lat,
                      lon: data.lon,
                    } : {
                      index: 0,
                      total: 1,
                      lat: data.lat,
                      lon: data.lon,
                      speed: 0,
                    }
                  }
                };
              });
            }
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
        setLastError("Message moteur illisible.");
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed. Attempting reconnect in 2s...");
      setIsConnected(false);
      setConnectionStatus("reconnecting");
      setLastError("Connexion au moteur perdue. Nouvelle tentative dans 2 s.");
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setLastError(`Impossible de joindre ${connectionUrl}.`);
      ws.close();
    };
  };

  // Resolve the actual engine port chosen by the Rust side (persisted config,
  // defaults to DEFAULT_PORT) before opening the first WebSocket connection.
  useEffect(() => {
    // These commands manage the Tauri-spawned sidecar; in browser mode the
    // engine is whatever served this page, so there's nothing to resolve.
    if (!isTauri) {
      return;
    }
    invoke<number>("get_engine_port")
      .then((port) => setEnginePortState(port))
      .catch(() => {
        // Not running inside Tauri (e.g. `vite dev` in a browser): keep the default port.
      });
    invoke<string | null>("get_mdns_interface")
      .then((iface) => setMdnsInterfaceState(iface))
      .catch(() => {
        // Not running inside Tauri: no interface to restrict.
      });
    invoke<NetworkInterfaceInfo[]>("list_network_interfaces")
      .then((interfaces) => setNetworkInterfaces(interfaces))
      .catch(() => {
        // Not running inside Tauri: nothing to list.
      });
  }, []);

  useEffect(() => {
    // Sidecar lifecycle events only exist under Tauri; browser mode derives
    // engine status from the WebSocket connection instead.
    if (!isTauri) {
      return;
    }
    // `listen()` resolves asynchronously; if cleanup already ran by the time
    // it does (StrictMode double-effect, fast remount), `cancelled` skips
    // registering a handler that would otherwise never get unsubscribed —
    // the bare `unlistenStatus.then((fn) => fn())` below still unsubscribes
    // once the promise resolves, but only after a window where two listeners
    // could briefly coexist.
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    listen<string>("engine-status", (event) => {
      const payload = event.payload;
      if (payload === "starting") {
        setEngineStatus("starting");
      } else if (payload.startsWith("exited") || payload.startsWith("error")) {
        setEngineStatus("crashed");
        setLastError(`Moteur GPS-Mock indisponible (${payload}).`);
      } else {
        setEngineStatus("running");
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unsubscribe = fn;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Browser mode bootstrap: capture credentials handed in via the URL (the QR
  // encodes the engine origin plus ?pair=<rotating-code>, or a ?token= for a
  // pre-provisioned client), then decide whether we can connect or must pair.
  useEffect(() => {
    if (isTauri) {
      return;
    }
    const params = new URLSearchParams(window.location.search);

    const urlToken = params.get("token");
    if (urlToken) {
      setStoredToken(urlToken);
      setDeviceToken(urlToken);
    }
    const pair = params.get("pair");
    if (pair) {
      setPrefillCode(pair);
    }
    // Strip credentials from the address bar so they aren't bookmarked/shared.
    if (urlToken || pair) {
      params.delete("token");
      params.delete("pair");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }

    // No durable token (and none just provided) ⇒ this remote client must pair
    // before it can open the WebSocket.
    if (!urlToken && !getStoredToken()) {
      setNeedsPairing(true);
    }
  }, []);

  useEffect(() => {
    // Browser mode without a token: don't dial (the engine would reject a
    // tokenless remote handshake); wait for the user to pair instead.
    if (!isTauri && !deviceToken) {
      return;
    }
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enginePort, deviceToken]);

  const setEnginePort = async (port: number) => {
    // Restarting the engine on a new port is a Tauri-sidecar concern; in
    // browser mode the engine's port is fixed by however it was launched.
    if (!isTauri) {
      return;
    }
    setEngineStatus("starting");
    await invoke("set_engine_port", { port });
    setEnginePortState(port);
  };

  const setMdnsInterface = async (interfaceName: string | null) => {
    if (!isTauri) {
      return;
    }
    setEngineStatus("starting");
    await invoke("set_mdns_interface", { interface: interfaceName });
    setMdnsInterfaceState(interfaceName);
  };

  const canSend = isConnected && wsRef.current?.readyState === WebSocket.OPEN;

  const sendMessage = (type: string, data: any = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
      return true;
    } else {
      console.warn("WebSocket not connected. Cannot send:", type);
      setLastError("Action impossible: le moteur GPS-Mock est hors ligne.");
      return false;
    }
  };

  const setLocation = (lat: number, lon: number, name = "Point Injecté") => {
    sendMessage("SET_LOCATION", { lat, lon, name });
  };

  const clearLocation = () => {
    sendMessage("CLEAR_LOCATION");
  };

  const playRoute = (endLat: number, endLon: number, speed: number, profile: "driving" | "walking" | "cycling") => {
    sendMessage("PLAY_ROUTE", { endLat, endLon, speed, profile });
  };

  const playSequence = (legs: any[], looping: boolean) => {
    sendMessage("PLAY_SEQUENCE", { legs, looping });
  };

  const playCustomGpx = (gpxContent: string, speed: number) => {
    sendMessage("PLAY_CUSTOM_GPX", { gpxContent, speed });
  };

  const stopRoute = () => {
    sendMessage("STOP_ROUTE");
  };

  const pauseRoute = () => {
    sendMessage("PAUSE_ROUTE");
  };

  const resumeRoute = () => {
    sendMessage("RESUME_ROUTE");
  };

  const relance = () => {
    sendMessage("RELANCE");
  };

  const saveSettings = (newSettings: Settings) => {
    sendMessage("SAVE_SETTINGS", newSettings);
  };

  const addFavorite = (lat: number, lon: number, name: string) => {
    sendMessage("ADD_FAVORITE", { lat, lon, name });
  };

  const removeFavorite = (lat: number, lon: number) => {
    sendMessage("REMOVE_FAVORITE", { lat, lon });
  };

  const renameFavorite = (lat: number, lon: number, newName: string) => {
    sendMessage("RENAME_FAVORITE", { lat, lon, newName });
  };

  const updatePatrolZone = (zone: PatrolZone | null) => {
    sendMessage("PATROL_UPDATE", { zone });
  };

  const getDeviceInfo = () => {
    setDeviceDetails(null);
    sendMessage("GET_DEVICE_INFO");
  };

  const getDiagnostics = () => {
    setDiagnostics(null);
    sendMessage("GET_DIAGNOSTICS");
  };

  const getNetworkDevices = () => {
    setNetworkDevices(null);
    sendMessage("GET_NETWORK_DEVICES");
  };

  // Runs the active driver's Lockdown pairing handshake against a
  // USB-connected device (the "Faire confiance ?" prompt) — see
  // docs/IOS_PAIRING_TUNNEL.md. `pairing` stays true until PAIR_RESULT
  // arrives, since the user has to physically accept the prompt on their
  // phone before the engine's reply comes back (up to ~45s).
  const pairDevice = () => {
    setPairResult(null);
    setPairing(true);
    sendMessage("PAIR_DEVICE");
  };

  // submitCode redeems the desktop's rotating pairing code for a durable token
  // (browser mode). On success the token is stored and the connection effect
  // re-runs to open the now-authorized WebSocket.
  const submitCode = async (code: string, label?: string): Promise<boolean> => {
    setPairCodeError(null);
    try {
      const resp = await fetch(sameOriginHttpUrl("/api/pair"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), label: label || navigator.userAgent.slice(0, 60) }),
      });
      if (!resp.ok) {
        setPairCodeError(resp.status === 401 ? "Code invalide ou expiré." : `Échec de l'appairage (${resp.status}).`);
        return false;
      }
      const data = (await resp.json()) as { token?: string };
      if (!data.token) {
        setPairCodeError("Réponse d'appairage invalide.");
        return false;
      }
      setStoredToken(data.token);
      setPrefillCode(null);
      setNeedsPairing(false);
      setDeviceToken(data.token); // triggers the connect effect
      return true;
    } catch {
      setPairCodeError("Impossible de joindre le moteur.");
      return false;
    }
  };

  // forgetPairing drops the durable token so this client can re-pair from
  // scratch (e.g. after the desktop revoked it, leaving the WS unable to
  // reconnect).
  const forgetPairing = () => {
    clearStoredToken();
    setDeviceToken(null);
    setNeedsPairing(true);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
  };

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        connectionStatus,
        connectionUrl,
        enginePort,
        engineStatus,
        setEnginePort,
        mdnsInterface,
        setMdnsInterface,
        networkInterfaces,
        lastError,
        canSend,
        status,
        telemetry,
        deviceDetails,
        logs,
        getDeviceInfo,
        sendMessage,
        setLocation,
        clearLocation,
        playRoute,
        playSequence,
        playCustomGpx,
        stopRoute,
        pauseRoute,
        resumeRoute,
        relance,
        saveSettings,
        addFavorite,
        removeFavorite,
        renameFavorite,
        updatePatrolZone,
        diagnostics,
        getDiagnostics,
        networkDevices,
        getNetworkDevices,
        pairResult,
        pairing,
        pairDevice,
        needsPairing,
        pairCodeError,
        prefillCode,
        submitCode,
        forgetPairing,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
