export interface Coords {
  latitude: number;
  longitude: number;
  name?: string;
  savedAt?: number;
}

// Interface pour les données brutes venant du serveur
export interface RawCoords {
  lat: number;
  lon: number;
  name?: string;
  timestamp?: number;
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
  lastInjectedLocation: RawCoords | null;
  lastVerifiedLocation: RawCoords | null;
  usbDriver: string;
  wifiDriver: string;
  fallbackEnabled: boolean;
  favorites: RawCoords[];
  recentHistory: RawCoords[];
}
