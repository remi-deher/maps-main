import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { Coords, ServerStatus } from '../types';
import { logEvent } from '../services/logger';

interface AppStore {
  // States
  serverIp: string;
  serverPort: string;
  status: string;
  serverStatus: ServerStatus | null;
  simulatedCoords: Coords | null;
  isMaintaining: boolean;
  
  // Actions
  setSettings: (ip: string, port: string) => Promise<void>;
  setIsMaintaining: (val: boolean) => void;
  connect: () => void;
  disconnect: () => void;
  sendAction: (type: string, data?: any) => void;
  loadSettings: () => Promise<void>;
}

let socket: Socket | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  serverIp: '',
  serverPort: '8080',
  status: 'Déconnecté',
  serverStatus: null,
  simulatedCoords: null,
  isMaintaining: false,

  loadSettings: async () => {
    try {
      const ip = await AsyncStorage.getItem('serverIp');
      const port = await AsyncStorage.getItem('serverPort');
      if (ip) set({ serverIp: ip });
      if (port) set({ serverPort: port });
    } catch (e) {}
  },

  setSettings: async (ip, port) => {
    await AsyncStorage.setItem('serverIp', ip);
    await AsyncStorage.setItem('serverPort', port);
    set({ serverIp: ip, serverPort: port });
    get().connect();
  },

  setIsMaintaining: (val) => set({ isMaintaining: val }),

  connect: () => {
    const { serverIp, serverPort } = get();
    if (!serverIp) return;

    if (socket) {
      socket.disconnect();
    }

    const url = `http://${serverIp}:${serverPort}`;
    logEvent.add(`🔌 Connexion Socket.io à ${url}`);
    
    socket = io(url, {
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      transports: ['websocket']
    });

    socket.on('connect', () => {
      set({ status: 'Connecté' });
      logEvent.add('✅ Socket.io connecté', 'success');
      socket?.emit('GET_STATUS');
    });

    socket.on('disconnect', () => {
      set({ status: 'Déconnecté' });
      logEvent.add('❌ Socket.io déconnecté', 'info');
    });

    socket.on('error', (err) => {
      logEvent.add(`⚠️ Erreur Socket: ${err.message}`, 'error');
    });

    socket.on('STATUS', (data: ServerStatus) => {
      set({ serverStatus: data });
      if (data.lastInjectedLocation) {
        set({ simulatedCoords: { 
            latitude: data.lastInjectedLocation.lat as any, 
            longitude: data.lastInjectedLocation.lon as any,
            name: data.lastInjectedLocation.name 
        } });
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
    } else {
      logEvent.add(`Action ${type} impossible (Hors ligne)`, 'info');
    }
  }
}));
