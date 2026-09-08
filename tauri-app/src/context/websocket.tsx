import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isTauri, sameOriginWsUrl, getStoredToken } from "../lib/runtime";
import { engineEvents } from "../lib/events";
import { useLogs } from "./logsContext";
import { usePairing } from "./pairingContext";
import { applyEngineEvent } from "../features/engine/engineEventDispatch";
import { createEngineActions } from "../features/engine/engineActions";
import { useTauriBridge } from "../features/engine/useTauriBridge";
import type {
  DeviceDetails,
  Diagnostics,
  EngineMessageData,
  EngineTransportContextType,
  NetworkDevicesResult,
  Status,
  Telemetry,
} from "../types/engine";
import { EngineAction } from "../types/engineMessages";

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

/// Owns the engine connection: the socket itself, its reconnection policy, and
/// the state the whole UI reads from it.
///
/// What used to sit here too now lives beside it — the inbound envelope routing
/// in `engineEventDispatch`, the Tauri shell's port/supervisor bridge in
/// `useTauriBridge`, and the ~25 one-line action wrappers in `engineActions` —
/// so this file is about the transport and nothing else.
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lastError, setLastError] = useState<string | null>(null);
  const {
    enginePort,
    setEnginePort,
    engineStatus,
    setEngineStatus,
    mdnsInterface,
    setMdnsInterface,
    networkInterfaces,
  } = useTauriBridge(setLastError);

  const [deviceToken, setDeviceToken] = useState<string | null>(() => (isTauri ? null : getStoredToken()));

  const connectionUrl = isTauri ? `ws://localhost:${enginePort}/ws` : sameOriginWsUrl("/ws");
  // The device token is offered as a WebSocket subprotocol rather than a
  // `?token=` query param: a browser can't set an Authorization header on a
  // handshake, but a credential in the URL is copied into the engine's access
  // logs and into the Referer of anything the URL reaches. The engine reads
  // `Sec-WebSocket-Protocol: bearer, <token>` and echoes "bearer" back (see
  // engine/internal/server/auth.go). Tauri talks to its own loopback sidecar,
  // which needs no credential at all.
  const connectionProtocols = useMemo(
    () => (!isTauri && deviceToken ? ["bearer", deviceToken] : undefined),
    [deviceToken],
  );

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<EngineTransportContextType["connectionStatus"]>("connecting");
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

  // Detaches the handlers before closing so the teardown doesn't trigger the
  // reconnect path we are trying to cancel.
  const closeSocket = () => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close();
  };

  const connect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    closeSocket();

    console.log(`Connecting to GPS-Mock engine WebSocket on port ${enginePort}...`);
    setConnectionStatus((previous) => (previous === "disconnected" ? "reconnecting" : "connecting"));
    const ws = new WebSocket(connectionUrl, connectionProtocols);
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
        const { type, data } = JSON.parse(event.data);
        applyEngineEvent(type, data, {
          setStatus,
          setTelemetry,
          setDeviceDetails,
          setDiagnostics,
          setNetworkDevices,
        });
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
    const handleReconnect = (token: string | null) => {
      setDeviceToken(token);
    };
    engineEvents.on("reconnect", handleReconnect);
    return () => {
      engineEvents.off("reconnect", handleReconnect);
    };
  }, []);

  useEffect(() => {
    // In a browser, a device token is the prerequisite: the engine rejects a
    // tokenless remote client, so connecting before pairing would just loop.
    if (!isTauri && !deviceToken) {
      return;
    }
    connect();
    return () => {
      closeSocket();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enginePort, deviceToken]);

  const canSend = isConnected && wsRef.current?.readyState === WebSocket.OPEN;

  const sendMessage = (type: string, data: EngineMessageData = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
      return true;
    }
    console.warn("WebSocket not connected. Cannot send:", type);
    setLastError("Action impossible: le moteur GPS-Mock est hors ligne.");
    return false;
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

  const actions = createEngineActions({
    send: sendMessage,
    clearDeviceDetails: () => setDeviceDetails(null),
    clearDiagnostics: () => setDiagnostics(null),
    clearNetworkDevices: () => setNetworkDevices(null),
  });

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
        diagnostics,
        networkDevices,
        sendMessage,
        ...actions,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
