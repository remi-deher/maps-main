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

// The server broadcasts TELEMETRY every 5s, so any healthy connection yields a
// message well within this window. Past it, the socket is presumed a zombie
// (OS froze it during sleep, Wi-Fi dropped without a close frame) and is force-
// closed to trigger the normal reconnect — even though readyState still says
// OPEN. Checked on a short interval.
const STALE_AFTER_MS = 15_000;
const STALE_CHECK_MS = 5_000;
// Softer threshold than STALE_AFTER_MS: past this the displayed status/telemetry
// is flagged as possibly outdated in the UI, before the harder cutoff forces a
// reconnect. Keeps widgets from presenting frozen data as live.
const STALE_WARN_MS = 8_000;

// Reconnect backoff: start fast, grow exponentially to a ceiling, with jitter
// so multiple LAN clients don't retry in lockstep against an engine that just
// came back. Reset to base on a successful open.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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
  // True when no frame has arrived recently (see STALE_WARN_MS): the UI dims
  // status/telemetry and shows an "outdated" hint instead of pretending live.
  const [isStale, setIsStale] = useState(false);
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevicesResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  // Wall-clock time of the last frame received, used by the staleness watchdog.
  const lastMessageRef = useRef<number>(Date.now());
  // Current reconnect backoff delay, grown on each close and reset on open.
  const reconnectDelayRef = useRef<number>(RECONNECT_BASE_MS);
  // Holds the latest `connect` closure so the wake handlers (whose effect runs
  // once) can call the current version without re-subscribing every render.
  const connectRef = useRef<() => void>(() => {});

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
      lastMessageRef.current = Date.now();
      reconnectDelayRef.current = RECONNECT_BASE_MS;
      setIsStale(false);
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
      lastMessageRef.current = Date.now();
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
      setIsConnected(false);
      setConnectionStatus("reconnecting");
      const delay = reconnectDelayRef.current;
      const jittered = delay + Math.floor(Math.random() * 1000);
      console.log(`WebSocket closed. Attempting reconnect in ${Math.round(jittered / 1000)}s...`);
      setLastError(`Connexion au moteur perdue. Nouvelle tentative dans ${Math.round(jittered / 1000)} s.`);
      reconnectTimeoutRef.current = setTimeout(connect, jittered);
      // Grow the backoff for the next attempt (reset to base once open again).
      reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setLastError(`Impossible de joindre ${connectionUrl}.`);
      ws.close();
    };
  };

  connectRef.current = connect;

  // Staleness watchdog: an OPEN socket that hasn't produced a frame within
  // STALE_AFTER_MS is a zombie (the browser won't surface a broken pipe after
  // sleep). Closing it routes through onclose -> reconnect.
  useEffect(() => {
    const id = window.setInterval(() => {
      const ws = wsRef.current;
      const age = Date.now() - lastMessageRef.current;
      const open = ws && ws.readyState === WebSocket.OPEN;
      // Flag stale data before the hard cutoff so widgets can dim/warn.
      setIsStale(!!open && age > STALE_WARN_MS);
      if (open && age > STALE_AFTER_MS) {
        console.warn("WebSocket stale (no frame in >%dms), forcing reconnect", STALE_AFTER_MS);
        setConnectionStatus("reconnecting");
        ws!.close();
      }
    }, STALE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  // On wake (tab refocus, network back, window focus) re-check immediately
  // rather than waiting out the watchdog interval or the reconnect timer.
  useEffect(() => {
    const wake = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (Date.now() - lastMessageRef.current > STALE_AFTER_MS) {
          ws.close();
        }
        return;
      }
      // Socket already down: if a reconnect was scheduled, fire it now. Only
      // when a timer exists, so we never initiate a connection the normal flow
      // wouldn't (e.g. web without a device token yet).
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        connectRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
      } else if (payload.startsWith("restarting")) {
        // "restarting:<attempt>:<max>" — the supervisor is auto-respawning a
        // crashed engine. Show a starting state with a countdown-ish hint.
        setEngineStatus("starting");
        const [, attempt, max] = payload.split(":");
        setLastError(
          attempt && max
            ? `Moteur GPS-Mock interrompu, redémarrage automatique (tentative ${attempt}/${max})…`
            : "Moteur GPS-Mock interrompu, redémarrage automatique…"
        );
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

  const restartServices = () => {
    sendMessage(EngineAction.RestartServices);
  };

  const restartTunnel = () => {
    sendMessage(EngineAction.RestartTunnel);
  };

  const restartMdns = () => {
    sendMessage(EngineAction.RestartMdns);
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
        isStale,
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
        restartServices,
        restartTunnel,
        restartMdns,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
