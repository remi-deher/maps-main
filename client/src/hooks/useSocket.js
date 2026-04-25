import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { eventBus } from '../services/background';
import { logEvent } from '../services/logger';

const COORDS_TTL_MS  = 30 * 60 * 1000; // 30 min (Replay TTL)
const ACK_TIMEOUT_MS = 3000;            // 3s sans ACK → renvoi
const PING_INTERVAL  = 3000;            // Heartbeat strict
const MAX_RETRY_MS   = 30000;           // Backoff plafonné à 30s

export function useSocket(ip, port, isMaintaining) {
  const [status, setStatus]               = useState('Déconnecté');
  const [favorites, setFavorites]         = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const [deviceInfo, setDeviceInfo]       = useState(null);
  const [connectionType, setConnectionType] = useState(null);
  const [rsdAddress, setRsdAddress]       = useState(null);
  const [serverState, setServerState] = useState('idle');
  const [verifiedLocation, setVerifiedLocation] = useState(null);

  const ws            = useRef(null);
  const isConnecting  = useRef(false);
  const statusRef     = useRef('Déconnecté');
  const lastConfig    = useRef({ ip: null, port: null });
  const appState      = useRef(AppState.currentState);

  // --- Couche 1 : Backoff exponentiel ---
  const retryDelay    = useRef(1000);
  const retryTimer    = useRef(null);

  // --- Couche 4 : ACK serveur ---
  const pendingAck    = useRef(null);
  const pendingAckData = useRef(null);

  // ─────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────

  const updateStatus = useCallback((next) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  }, []);

  const clearRetryTimer = () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  };

  const clearAckTimer = () => {
    if (pendingAck.current) {
      clearTimeout(pendingAck.current);
      pendingAck.current = null;
    }
    pendingAckData.current = null;
  };

  const stop = useCallback((reason = 'Non spécifiée') => {
    clearRetryTimer();
    clearAckTimer();
    if (ws.current) {
      logEvent.add(`Fermeture WS — ${reason}`);
      ws.current.onclose = null; // évite le re-schedule du retry
      ws.current.close();
      ws.current = null;
    }
    isConnecting.current = false;
  }, []);

  // ─────────────────────────────────────────
  // Couche 2 : Replay des dernières coords
  // ─────────────────────────────────────────

  const replayLastCoords = useCallback(async (force = false) => {
    try {
      const raw = await AsyncStorage.getItem('MOCK_LOCATION');
      if (!raw) return;
      const saved = JSON.parse(raw);
      const age = Date.now() - (saved.savedAt || 0);
      
      // Option C : On ignore le TTL si c'est une restauration forcée (serveur vide)
      if (!force && age > COORDS_TTL_MS) {
        logEvent.add('Coords expirées (TTL > 30min), pas de replay');
        return;
      }
      
      if (ws.current?.readyState === WebSocket.OPEN) {
        const { latitude, longitude, name } = saved;
        ws.current.send(JSON.stringify({ type: 'SET_LOCATION', data: { lat: latitude, lon: longitude, name } }));
        logEvent.add(`🔄 Restauration ${force ? '(Forcée)' : '(Auto)'} : ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }
    } catch (e) {
      logEvent.add(`Erreur replay : ${e.message}`, 'error');
    }
  }, []);

  // ─────────────────────────────────────────
  // Connexion principale
  // ─────────────────────────────────────────

  const connect = useCallback(() => {
    if (!ip || isConnecting.current || statusRef.current === 'Connecté') return;

    isConnecting.current = true;
    updateStatus('Connexion...');
    
    try {
      ws.current = new WebSocket(`ws://${ip}:${port}`);

      const connectionTimeout = setTimeout(() => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
          logEvent.add('Timeout connexion 5s', 'error');
          stop('Timeout connexion');
          scheduleRetry();
        }
      }, 5000);

      ws.current.onopen = async () => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        retryDelay.current = 1000; // Reset backoff (Couche 1)
        updateStatus('Connecté');
        logEvent.add('WS connecté', 'success');

        // Au démarrage, on demande l'état au serveur
        ws.current.send(JSON.stringify({ type: 'GET_STATUS' }));
      };

      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);

          // Couche 4 : réception ACK
          if (payload.type === 'ACK') {
            clearAckTimer();
            logEvent.add(`ACK reçu pour ${payload.data?.lat?.toFixed(4)}`, 'success');
            return;
          }

          if (payload.type === 'STATUS') {
            if (payload.data.favorites)     setFavorites(payload.data.favorites);
            if (payload.data.recentHistory) setRecentHistory(payload.data.recentHistory);
            if (payload.data.deviceInfo)    setDeviceInfo(payload.data.deviceInfo);
            if (payload.data.connectionType) setConnectionType(payload.data.connectionType);
            if (payload.data.rsdAddress)    setRsdAddress(payload.data.rsdAddress);
            
            setServerState(payload.data.state);
            setVerifiedLocation(payload.data.lastVerifiedLocation);

            if (payload.data.state === 'idle') {
               logEvent.add("ℹ️ Serveur vierge détecté. Déclenchement restauration Option C...");
               replayLastCoords(true); // Restauration forcée sans TTL
            } else if (payload.data.state === 'starting') {
               logEvent.add("⏳ Serveur en cours de démarrage, attente...");
            } else {
               logEvent.add(`✅ Simulation déjà active sur le serveur (${payload.data.state})`);
            }
          } else if (payload.type === 'LOCATION') {
            const coords = {
              latitude:  payload.data.lat,
              longitude: payload.data.lon,
              name:      payload.data.name,
              savedAt:   Date.now()
            };
            setSimulatedCoords(coords);
            // Sauvegarde pour le Replay et la Tâche de fond
            AsyncStorage.setItem('MOCK_LOCATION', JSON.stringify(coords));
          }
        } catch (_) {}
      };

      ws.current.onclose = (e) => {
        isConnecting.current = false;
        updateStatus('Déconnecté');
        logEvent.add(`WS fermé (code ${e.code})`, 'info');
        scheduleRetry();
      };

      ws.current.onerror = (e) => {
        isConnecting.current = false;
        updateStatus('Erreur');
        logEvent.add(`Erreur WS : ${e.message}`, 'error');
      };

    } catch (e) {
      isConnecting.current = false;
      updateStatus('Erreur');
      logEvent.add(`Exception WS : ${e.message}`, 'error');
      scheduleRetry();
    }
  }, [ip, port, replayLastCoords, stop, updateStatus, scheduleRetry]);

  // ─────────────────────────────────────────
  // Couche 1 : Backoff exponentiel
  // ─────────────────────────────────────────

  const scheduleRetry = useCallback(() => {
    if (!ip) return;
    clearRetryTimer();
    const delay = retryDelay.current;
    logEvent.add(`Retry dans ${delay / 1000}s…`);
    retryTimer.current = setTimeout(() => {
      retryDelay.current = Math.min(delay * 2, MAX_RETRY_MS);
      connect();
    }, delay);
  }, [ip, connect]);

  // ─────────────────────────────────────────
  // Envoi d'action + persistance + ACK
  // ─────────────────────────────────────────

  const sendAction = useCallback(async (type, data) => {
    // Couche 2 + 4 : Persistance et ACK pour SET_LOCATION
    if (type === 'SET_LOCATION') {
      try {
        const coordsToSave = {
          latitude: data.lat,
          longitude: data.lon,
          name: data.name,
          savedAt: Date.now()
        };
        await AsyncStorage.setItem('MOCK_LOCATION', JSON.stringify(coordsToSave));
      } catch (_) {}

      // Couche 4 : Armer le timer ACK avec fonction récursive nommée
      clearAckTimer();
      pendingAckData.current = data;
      
      const retransmit = () => {
        if (ws.current?.readyState === WebSocket.OPEN && pendingAckData.current) {
          logEvent.add('Pas d\'ACK — renvoi coords...', 'error');
          ws.current.send(JSON.stringify({ type: 'SET_LOCATION', data: pendingAckData.current }));
          pendingAck.current = setTimeout(retransmit, ACK_TIMEOUT_MS);
        }
      };
      
      pendingAck.current = setTimeout(retransmit, ACK_TIMEOUT_MS);
    }

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    } else {
      logEvent.add(`Action ${type} en attente (WS fermé)`, 'info');
    }
  }, []);

  // ─────────────────────────────────────────
  // Effet : changement de config / watchdog
  // ─────────────────────────────────────────

  useEffect(() => {
    const configChanged = lastConfig.current.ip !== ip || lastConfig.current.port !== port;

    if (configChanged) {
      logEvent.add(`Nouvelle config : ${ip}:${port}`);
      lastConfig.current = { ip, port };
      stop('Changement IP/Port');
      retryDelay.current = 1000;
      if (ip) {
        AsyncStorage.setItem('SERVER_CONFIG', JSON.stringify({ ip, port }));
        connect();
      }
    }

    const watchdog = setInterval(() => {
      if (ip && statusRef.current === 'Déconnecté' && !isConnecting.current && !retryTimer.current) {
        logEvent.add('Watchdog : relance connexion');
        connect();
      }
    }, 10000);

    return () => clearInterval(watchdog);
  }, [ip, port, connect, stop]);

  // ─────────────────────────────────────────
  // Effet : AppState (retour au premier plan)
  // ─────────────────────────────────────────

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        logEvent.add('Retour premier plan');
        if (statusRef.current !== 'Connecté') {
          clearRetryTimer();
          retryDelay.current = 1000;
          connect();
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [connect]);

  // ─────────────────────────────────────────
  // Effet : heartbeat strict (WiFi keepalive)
  // ─────────────────────────────────────────

  useEffect(() => {
    const sendHeartbeat = () => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'HEARTBEAT',
          data: { isMaintaining, timestamp: Date.now() },
        }));
      }
    };

    const unsubBus = eventBus.subscribe((ev) => {
      if (ev.type === 'TICK' && isMaintaining) sendHeartbeat();
      if (ev.type === 'LOG') logEvent.add(ev.message);
    });

    const timer = setInterval(() => {
      if (statusRef.current === 'Connecté' && isMaintaining) sendHeartbeat();
    }, PING_INTERVAL);

    return () => {
      unsubBus();
      clearInterval(timer);
    };
  }, [isMaintaining]);

  // ─────────────────────────────────────────
  // Effet : relais logs
  // ─────────────────────────────────────────

  useEffect(() => {
    const unsub = logEvent.subscribe((history) => {
      const latest = history[0];
      if (latest && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'CLIENT_LOG', data: latest }));
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    return () => stop('Démontage composant');
  }, [stop]);

  return {
    status,
    favorites,
    recentHistory,
    simulatedCoords,
    deviceInfo,
    connectionType,
    rsdAddress,
    serverState,
    verifiedLocation,
    sendAction,
    connect,
    stop
  };
}
