import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isTauri,
  sameOriginWsUrl,
  getStoredToken,
} from "../lib/runtime";
import { engineEvents } from "../lib/events";
import { useLogs } from "./logsContext";
import { usePairing } from "./pairingContext";
import type {
  DeviceDetails,
  Diagnostics,
  EngineMessageData,
  EngineTransportContextType,
  NetworkDevicesResult,
  NetworkInterfaceInfo,
  PatrolZone,
  PlaySequenceLeg,
  RouteProfile,
  Settings,
  Status,
  Telemetry,
} from "../types/engine";
import { EngineAction, EngineEvent } from "../types/engineMessages";

const DEFAULT_PORT = 8080;

export type {
  DeviceDetails,
  Diagnostics,
  LatLon,
  NetworkDevicesResult,
  NetworkInterfaceInfo,
  PatrolZone,
  PlaySequenceLeg,
  RouteProfile,
  Settings,
  Status,
  Telemetry,
} from "../types/engine";

const WebSocketContext = createContext<EngineTransportContextType | null>(null);

export const useEngine = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useEngine must be used within a WebSocketProvider");
  }
  return context;
};

export const useWebSocket = () => {
  const ws = useEngine();
  const logs = useLogs();
  const pairing = usePairing();
  return {
    ...ws,
    ...logs,
    ...pairing,
  };
};

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enginePort, setEnginePortState] = useState(DEFAULT_PORT);
  const [engineStatus, setEngineStatus] = useState<EngineTransportContextType["engineStatus"]>("unknown");
  const [mdnsInterface, setMdnsInterfaceState] = useState<string | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [deviceToken, setDeviceToken] = useState<string | null>(() => (isTauri ? null : getStoredToken()));

  const connectionUrl = isTauri
    ? `ws://localhost:${enginePort}/ws`
    : sameOriginWsUrl("/ws") + (deviceToken ? `?token=${encodeURIComponent(deviceToken)}` : "");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<EngineTransportContextType["connectionStatus"]>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevicesResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
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
      if (!isTauri) {
        setEngineStatus("running");
      }
      ws.send(JSON.stringify({ type: EngineAction.GetStatus }));
      ws.send(JSON.stringify({ type: EngineAction.GetLogs }));
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const { type, data } = envelope;

        switch (type) {
          case EngineEvent.Status:
          case EngineEvent.StatusUpdate:
            setStatus(data);
            break;
          case EngineEvent.Telemetry:
            setTelemetry(data);
            break;
          case EngineEvent.DeviceInfo:
            setDeviceDetails(data);
            break;
          case EngineEvent.Log:
            engineEvents.emit("log", data);
            break;
          case EngineEvent.Diagnostics:
            setDiagnostics(data);
            break;
          case EngineEvent.NetworkDevices:
            setNetworkDevices(data);
            break;
          case EngineEvent.PairResult:
            engineEvents.emit("pair_result", data);
            break;
          case EngineEvent.PairCode:
            engineEvents.emit("pair_code", data);
            break;
          case EngineEvent.PairedDevices:
            engineEvents.emit("paired_devices", data);
            break;
          case EngineEvent.Logs:
            engineEvents.emit("logs", data);
            break;
          case EngineEvent.Location:
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

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    invoke<number>("get_engine_port")
      .then((port) => setEnginePortState(port))
      .catch(() => {});
    invoke<string | null>("get_mdns_interface")
      .then((iface) => setMdnsInterfaceState(iface))
      .catch(() => {});
    invoke<NetworkInterfaceInfo[]>("list_network_interfaces")
      .then((interfaces) => setNetworkInterfaces(interfaces))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
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

  useEffect(() => {
    const handleReconnect = (token: string | null) => {
      setDeviceToken(token);
    };
    engineEvents.on("reconnect", handleReconnect);
    return () => {
      engineEvents.off("reconnect", handleReconnect);
    };
  }, []);

  useEffect(() => {
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

  const sendMessage = (type: string, data: EngineMessageData = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
      return true;
    } else {
      console.warn("WebSocket not connected. Cannot send:", type);
      setLastError("Action impossible: le moteur GPS-Mock est hors ligne.");
      return false;
    }
  };

  useEffect(() => {
    const handleSend = (type: string, data?: EngineMessageData) => {
      sendMessage(type, data);
    };
    engineEvents.on("send", handleSend);
    return () => {
      engineEvents.off("send", handleSend);
    };
  }, [isConnected]);

  const setLocation = (lat: number, lon: number, name = "Point Injecté") => {
    sendMessage(EngineAction.SetLocation, { lat, lon, name });
  };

  const clearLocation = () => {
    sendMessage(EngineAction.ClearLocation);
  };

  const playRoute = (endLat: number, endLon: number, speed: number, profile: RouteProfile) => {
    sendMessage(EngineAction.PlayRoute, { endLat, endLon, speed, profile });
  };

  const playSequence = (legs: PlaySequenceLeg[], looping: boolean) => {
    sendMessage(EngineAction.PlaySequence, { legs, looping });
  };

  const playCustomGpx = (gpxContent: string, speed: number) => {
    sendMessage(EngineAction.PlayCustomGpx, { gpxContent, speed });
  };

  const stopRoute = () => {
    sendMessage(EngineAction.StopRoute);
  };

  const pauseRoute = () => {
    sendMessage(EngineAction.PauseRoute);
  };

  const resumeRoute = () => {
    sendMessage(EngineAction.ResumeRoute);
  };

  const relance = () => {
    sendMessage(EngineAction.Relance);
  };

  const saveSettings = (newSettings: Settings) => {
    sendMessage(EngineAction.SaveSettings, newSettings);
  };

  const addFavorite = (lat: number, lon: number, name: string) => {
    sendMessage(EngineAction.AddFavorite, { lat, lon, name });
  };

  const removeFavorite = (lat: number, lon: number) => {
    sendMessage(EngineAction.RemoveFavorite, { lat, lon });
  };

  const renameFavorite = (lat: number, lon: number, newName: string) => {
    sendMessage(EngineAction.RenameFavorite, { lat, lon, newName });
  };

  const updatePatrolZone = (zone: PatrolZone | null) => {
    sendMessage(EngineAction.PatrolUpdate, { zone });
  };

  const getDeviceInfo = () => {
    setDeviceDetails(null);
    sendMessage(EngineAction.GetDeviceInfo);
  };

  const getDiagnostics = () => {
    setDiagnostics(null);
    sendMessage(EngineAction.GetDiagnostics);
  };

  const getNetworkDevices = () => {
    setNetworkDevices(null);
    sendMessage(EngineAction.GetNetworkDevices);
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
