import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { eventBus } from '../services/background';
import { logEvent } from '../services/logger';

export function useSocket(ip, port, isMaintaining) {
  const [status, setStatus] = useState('Déconnecté');
  const [favorites, setFavorites] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  
  const ws = useRef(null);
  const isConnecting = useRef(false);
  const appState = useRef(AppState.currentState);
  const statusRef = useRef('Déconnecté');
  const lastConfig = useRef({ ip: null, port: null });

  const updateStatus = (newStatus) => {
    if (statusRef.current !== newStatus) {
      statusRef.current = newStatus;
      setStatus(newStatus);
    }
  };

  const stop = useCallback((reason = "Non spécifiée") => {
    if (ws.current) {
      logEvent.add(`Fermeture WebSocket demandée. Raison: ${reason}`);
      ws.current.close();
      ws.current = null;
    }
    isConnecting.current = false;
  }, []);

  const connect = useCallback(() => {
    if (!ip || isConnecting.current || statusRef.current === 'Connecté') {
        return;
    }

    logEvent.add(`--- Tentative de connexion (isConnecting=${isConnecting.current}) ---`);
    isConnecting.current = true;
    updateStatus('Connexion...');
    
    const url = `ws://${ip}:${port}`;
    try {
      ws.current = new WebSocket(url);
      
      const connectionTimeout = setTimeout(() => {
          if (ws.current && ws.current.readyState !== WebSocket.OPEN) {
              logEvent.add("Timeout 5s atteint, abandon.", "error");
              stop("Timeout de connexion");
          }
      }, 5000);

      ws.current.onopen = () => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        updateStatus('Connecté');
        logEvent.add("WebSocket établi avec succès !", "success");
      };

      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            if (payload.data.favorites) setFavorites(payload.data.favorites);
            if (payload.data.recentHistory) setRecentHistory(payload.data.recentHistory);
          } else if (payload.type === 'LOCATION') {
            setSimulatedCoords({
              latitude: payload.data.lat,
              longitude: payload.data.lon,
              name: payload.data.name
            });
          }
        } catch (err) {}
      };

      ws.current.onclose = (e) => {
        isConnecting.current = false;
        updateStatus('Déconnecté');
        logEvent.add(`WebSocket déconnecté (Code: ${e.code})`, "info");
      };

      ws.current.onerror = (e) => {
        isConnecting.current = false;
        updateStatus('Erreur');
        logEvent.add(`Erreur réseau WebSocket: ${e.message || "Impossible de joindre le serveur"}`, "error");
      };
    } catch (e) {
      isConnecting.current = false;
      updateStatus('Erreur');
      logEvent.add(`Exception fatale WebSocket: ${e.message}`, "error");
    }
  }, [ip, port, stop]);

  // Effet 1 : Gestion de la configuration et cycle de vie
  useEffect(() => {
    const configChanged = lastConfig.current.ip !== ip || lastConfig.current.port !== port;
    
    if (configChanged) {
        logEvent.add(`Nouvelle config détectée: ${ip}:${port}`);
        lastConfig.current = { ip, port };
        stop("Changement de configuration IP/Port");
        if (ip) connect();
    }

    const reconnectInterval = setInterval(() => {
      if (ip && statusRef.current === 'Déconnecté' && !isConnecting.current) {
        logEvent.add("Watchdog: Auto-reconnect...");
        connect();
      }
    }, 5000);

    return () => {
      clearInterval(reconnectInterval);
      // On ne ferme le socket ici QUE si le composant est réellement détruit
      // mais on ne le fait pas si c'est juste un re-render
    };
  }, [ip, port, connect, stop]);

  // Effet 2 : AppState
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (statusRef.current !== 'Connecté') {
          logEvent.add("Retour au premier plan, reconnexion...");
          connect();
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [connect]);

  // Effet 3 : Heartbeat
  useEffect(() => {
    const sendHeartbeat = () => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'HEARTBEAT', data: { isMaintaining: isMaintaining } }));
        }
    };
    const unsubscribeBus = eventBus.subscribe((ev) => {
      if (ev.type === 'TICK' && isMaintaining) sendHeartbeat();
    });
    return () => unsubscribeBus();
  }, [isMaintaining]);

  const sendAction = (type, data) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    }
  };

  return { status, favorites, recentHistory, simulatedCoords, sendAction, connect };
}
