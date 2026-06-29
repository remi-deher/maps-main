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
  jitterEnabled?: boolean;
  preferredDriver?: string;
  usbDriver?: string;
  wifiDriver?: string;
  fallbackEnabled?: boolean;
  clusterMode?: "off" | "manual" | "auto";
  clusterHeartbeatSeconds?: number;
  clusterMasterDeadSeconds?: number;
  clusterPeerTimeoutSeconds?: number;
  osrmBaseUrl?: string;
  routingMode?: "auto" | "manual";
  routingProvider?: "google" | "mapbox" | "osrm";
  routingProviderPriority?: Array<"google" | "mapbox" | "osrm">;
  googleRoutesApiKey?: string;
  mapboxAccessToken?: string;
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

export interface RoutingProviderInfo {
  id: "google" | "mapbox" | "osrm";
  name: string;
  available: boolean;
  configured: boolean;
  profiles: Array<"driving" | "walking" | "cycling">;
}

export interface RoutingInfo {
  mode: "auto" | "manual";
  provider: "google" | "mapbox" | "osrm";
  activeProvider: "google" | "mapbox" | "osrm";
  priority: Array<"google" | "mapbox" | "osrm">;
  availableProviders: Array<"google" | "mapbox" | "osrm">;
  providers: RoutingProviderInfo[];
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
  routing?: RoutingInfo;
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

export interface PairedDevice {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
}

export interface RemotePairCode {
  code: string;
  secondsRemaining: number;
}

export type RouteProfile = "driving" | "walking" | "cycling";

export interface PlaySequenceLeg {
  type?: string;
  mode?: string;
  start?: LatLon;
  end?: LatLon;
  lat?: number;
  lon?: number;
  points?: LatLon[];
  speed?: number;
  duration?: number;
  startTime?: number;
  endTime?: number;
  pauseMs?: number;
  description?: string;
}

export type EngineMessageData = unknown;

export interface WebSocketContextType {
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
  sendMessage: (type: string, data?: EngineMessageData) => boolean;
  setLocation: (lat: number, lon: number, name?: string) => void;
  clearLocation: () => void;
  playRoute: (endLat: number, endLon: number, speed: number, profile: RouteProfile) => void;
  playSequence: (legs: PlaySequenceLeg[], looping: boolean) => void;
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
  needsPairing: boolean;
  pairCodeError: string | null;
  prefillCode: string | null;
  submitCode: (code: string, label?: string) => Promise<boolean>;
  forgetPairing: () => void;
  remotePairCode: RemotePairCode | null;
  pairedDevices: PairedDevice[];
  requestPairCode: () => void;
  requestPairedDevices: () => void;
  revokePairedDevice: (id: string) => void;
}
