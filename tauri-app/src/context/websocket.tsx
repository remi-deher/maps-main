import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri, sameOriginWsUrl } from "../lib/runtime";

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
  pmd3Path: string;
  pmd3Error?: string;
  lockdownDir: string;
  pairingRecords: PairingRecord[] | null;
  usbDevices: DiagnosticsDevice[] | null;
  usbDevicesError?: string;
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
  // Tauri: the engine runs as a localhost sidecar on the configured port.
  // Browser (engine's built-in web UI): same origin as the served page.
  const connectionUrl = isTauri ? `ws://localhost:${enginePort}/ws` : sameOriginWsUrl("/ws");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketContextType["connectionStatus"]>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevicesResult | null>(null);
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
    const unlistenStatus = listen<string>("engine-status", (event) => {
      const payload = event.payload;
      if (payload === "starting") {
        setEngineStatus("starting");
      } else if (payload.startsWith("exited") || payload.startsWith("error")) {
        setEngineStatus("crashed");
        setLastError(`Moteur GPS-Mock indisponible (${payload}).`);
      } else {
        setEngineStatus("running");
      }
    });
    return () => {
      unlistenStatus.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
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
  }, [enginePort]);

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
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
