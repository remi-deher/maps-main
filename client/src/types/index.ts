export interface Coords {
  latitude: number;
  longitude: number;
  name?: string;
  savedAt?: number;
}

export interface ServerStatus {
  state: 'idle' | 'ready' | 'starting' | 'running' | 'moving';
  tunnelActive: boolean;
  rsdAddress: string | null;
  rsdPort: number | null;
  connectionType: string | null;
  deviceInfo: any | null;
  maintainActive: boolean;
  lastHeartbeat: number | null;
  lastInjectedLocation: Coords | null;
  lastVerifiedLocation: Coords | null;
  usbDriver: string;
  wifiDriver: string;
  fallbackEnabled: boolean;
  favorites: Coords[];
  recentHistory: Coords[];
}

export interface AppState {
  // Config
  serverIp: string;
  serverPort: string;
  
  // Status
  status: string;
  serverStatus: ServerStatus | null;
  simulatedCoords: Coords | null;
  verifiedLocation: any | null;
  isMaintaining: boolean;
  
  // UI
  isLowPowerMode: boolean;
}
