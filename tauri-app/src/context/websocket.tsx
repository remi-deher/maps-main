import React, { createContext, useContext, useEffect, useRef, useState } from "react";

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
  logLevel?: string;
  notificationsEnabled?: boolean;
  dynamicIslandEnabled?: boolean;
}

export interface DeviceInfo {
  udid: string;
  name: string;
  driver: string;
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
  state: "idle" | "ready" | "starting" | "running" | "moving";
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
}

export interface Telemetry {
  latency: number;
  packetLoss: number;
  uptime: number;
  throughput: number;
}

interface WebSocketContextType {
  isConnected: boolean;
  status: Status | null;
  telemetry: Telemetry | null;
  sendMessage: (type: string, data?: any) => void;
  setLocation: (lat: number, lon: number, name?: string) => void;
  clearLocation: () => void;
  playRoute: (endLat: number, endLon: number, speed: number, profile: "driving" | "walking" | "cycling") => void;
  playSequence: (legs: any[], looping: boolean) => void;
  playCustomGpx: (gpxContent: string, speed: number) => void;
  relance: () => void;
  saveSettings: (settings: Settings) => void;
  addFavorite: (lat: number, lon: number, name: string) => void;
  removeFavorite: (lat: number, lon: number) => void;
  renameFavorite: (lat: number, lon: number, newName: string) => void;
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
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const connect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    console.log("Connecting to GPS-Mock engine WebSocket...");
    const ws = new WebSocket("ws://localhost:8080/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected successfully");
      setIsConnected(true);
      // Request initial status
      ws.send(JSON.stringify({ type: "GET_STATUS" }));
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
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed. Attempting reconnect in 2s...");
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
    };
  };

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const sendMessage = (type: string, data: any = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    } else {
      console.warn("WebSocket not connected. Cannot send:", type);
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

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        status,
        telemetry,
        sendMessage,
        setLocation,
        clearLocation,
        playRoute,
        playSequence,
        playCustomGpx,
        relance,
        saveSettings,
        addFavorite,
        removeFavorite,
        renameFavorite,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
