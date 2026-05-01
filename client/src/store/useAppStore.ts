import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { Coords, ServerStatus } from '../types';
import { logEvent } from '../services/logger';

interface AppStore {
  // States
  serverIp: string;
  serverPort: string;
  peerServers: { address: string, port: number }[];
  status: string;
  serverStatus: ServerStatus | null;
  simulatedCoords: Coords | null;
  realCoords: Coords | null;
  isMaintaining: boolean;
  
  // Actions
  setSettings: (ip: string, port: string) => Promise<void>;
  setIsMaintaining: (val: boolean) => void;
  connect: (retryIndex?: number) => void;
  disconnect: () => void;
  sendAction: (type: string, data?: any) => void;
  reportRealLocation: (coords: Coords) => void;
  loadSettings: () => Promise<void>;
}

let socket: Socket | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  serverIp: '',
  serverPort: '8080',
  peerServers: [],
  status: 'Déconnecté',
  serverStatus: null,
  simulatedCoords: null,
  realCoords: null,
  isMaintaining: false,

  loadSettings: async () => {
    try {
      const ip = await AsyncStorage.getItem('serverIp');
      const port = await AsyncStorage.getItem('serverPort');
      const mock = await AsyncStorage.getItem('MOCK_LOCATION');

      if (ip) set({ serverIp: ip });
      if (port) set({ serverPort: port });
      if (mock) {
        try {
          const coords = JSON.parse(mock);
          set({ simulatedCoords: coords });
        } catch (e) {}
      }
    } catch (e) {}
  },

  setSettings: async (ip, port) => {
    await AsyncStorage.setItem('serverIp', ip);
    await AsyncStorage.setItem('serverPort', port);
    set({ serverIp: ip, serverPort: port });
    get().connect();
  },

  setIsMaintaining: (val) => set({ isMaintaining: val }),

  reportRealLocation: (coords: Coords) => {
    set({ realCoords: coords });
    if (socket?.connected) {
      socket.emit('REAL_LOCATION', coords);
    }
  },

  connect: (retryIndex = -1) => {
    const { serverIp, serverPort, peerServers } = get();
    
    let targetIp = serverIp;
    let targetPort = serverPort;

    if (retryIndex >= 0 && peerServers.length > 0) {
      const peer = peerServers[retryIndex % peerServers.length];
      targetIp = peer.address;
      targetPort = String(peer.port);
      logEvent.add(`🔄 Essai serveur cluster : ${targetIp}:${targetPort}`, 'info');
    }

    if (!targetIp) return;

    if (socket) {
      socket.disconnect();
    }

    const url = `http://${targetIp}:${targetPort}`;
    logEvent.add(`🔌 Connexion à ${url}`);
    
    socket = io(url, {
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      transports: ['websocket']
    });

    socket.on('connect', () => {
      set({ status: 'Connecté', serverIp: targetIp, serverPort: targetPort });
      logEvent.add('✅ Connecté au cluster', 'success');
      socket?.emit('GET_STATUS');

      const heartbeatInterval = setInterval(() => {
        if (socket?.connected) {
          const { isMaintaining } = get();
          socket?.emit('HEARTBEAT', { isMaintaining, timestamp: Date.now() });
        }
      }, 15000);

      socket?.on('disconnect', () => {
        clearInterval(heartbeatInterval);
        set({ status: 'Déconnecté' });
        logEvent.add('❌ Déconnecté', 'info');
      });
    });

    socket.on('connect_error', () => {
      setTimeout(() => {
        get().connect(retryIndex + 1);
      }, 5000);
    });

    socket.on('STATUS', (data: ServerStatus) => {
      set({ serverStatus: data });
      // Mise à jour de la liste des pairs du cluster
      if (data.cluster && data.cluster.peers) {
        set({ peerServers: data.cluster.peers });
      }

      // Priorité 1: Position en cours (live)
      // Priorité 2: Position mémorisée par le serveur (reboot)
      const serverLoc = data.lastInjectedLocation || data.lastActiveLocation;

      if (serverLoc) {
        const coords = { 
          latitude: serverLoc.lat, 
          longitude: serverLoc.lon,
          name: serverLoc.name 
        };
        set({ simulatedCoords: coords });
        AsyncStorage.setItem('MOCK_LOCATION', JSON.stringify(coords));
      } else {
        // Priorité 3: Position locale de l'iPhone (si le serveur est vierge)
        const { simulatedCoords } = get();
        if (simulatedCoords && socket?.connected) {
          socket.emit('SET_LOCATION', { 
            lat: simulatedCoords.latitude, 
            lon: simulatedCoords.longitude, 
            name: simulatedCoords.name || "" 
          });
        }
      }
    });

    socket.on('LOCATION', (data: any) => {
      const coords = {
        latitude: data.lat,
        longitude: data.lon,
        name: data.name,
        savedAt: Date.now()
      };
      set({ simulatedCoords: coords });
      AsyncStorage.setItem('MOCK_LOCATION', JSON.stringify(coords));
    });

    socket.on('ACK', (data: any) => {
       logEvent.add(`ACK reçu pour ${data.lat?.toFixed(4)}`, 'success');
    });

    logEvent.subscribe((history) => {
      const last = history[0];
      if (last && socket?.connected) {
        socket.emit('DEBUG_LOG', `[iPhone] ${last.message}`);
      }
    });
  },

  disconnect: () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },

  sendAction: (type, data) => {
    if (socket?.connected) {
      socket.emit(type, data);
    }
  }
}));
