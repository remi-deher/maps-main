import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { eventBus } from '../services/background';
import { logEvent } from '../services/logger';

export function useSocket(ip, port, isMaintaining) {
  const [status, setStatus] = useState('Déconnecté');
  const [favorites, setFavorites] = useState([]);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const ws = useRef(null);
  const isConnecting = useRef(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Watchdog : Reconnexion au réveil de l'app
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (status !== 'Connecté') {
          logEvent.add("Réveil de l'app détecté, tentative de reconnexion...");
          connect();
        }
      }
      appState.current = nextAppState;
    });

    // Watchdog : Reconnexion cyclique
    const reconnectInterval = setInterval(() => {
      if (ip && status === 'Déconnecté' && !isConnecting.current) {
        logEvent.add("Watchdog: Tentative de reconnexion automatique...");
        connect();
      }
    }, 5000);

    // Heartbeat via le service de fond
    const unsubscribeBus = eventBus.subscribe((ev) => {
      if (ev.type === 'TICK' && isMaintaining) sendHeartbeat(true);
    });

    return () => {
      subscription.remove();
      clearInterval(reconnectInterval);
      unsubscribeBus();
      stop();
    };
  }, [ip, port, status, isMaintaining]);

  const connect = () => {
    if (!ip || isConnecting.current) {
        if (!ip) logEvent.add("Abandon connexion: IP non configurée", "error");
        return;
    }
    stop();
    isConnecting.current = true;
    setStatus('Connexion...');
    
    const url = `ws://${ip}:${port}`;
    logEvent.add(`Tentative de connexion à ${url}`);

    try {
      ws.current = new WebSocket(url);
      
      // Sécurité : Timeout de connexion
      const connectionTimeout = setTimeout(() => {
          if (ws.current && ws.current.readyState !== WebSocket.OPEN) {
              logEvent.add("Timeout de connexion WebSocket", "error");
              ws.current.close();
          }
      }, 5000);

      ws.current.onopen = () => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        setStatus('Connecté');
        logEvent.add("WebSocket Connecté !", "success");
        sendHeartbeat(isMaintaining);
      };

      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            if (payload.data.favorites) setFavorites(payload.data.favorites);
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
        setStatus('Déconnecté');
        logEvent.add(`WebSocket fermé (Code: ${e.code})`, "info");
      };

      ws.current.onerror = (e) => {
        isConnecting.current = false;
        setStatus('Erreur');
        logEvent.add(`Erreur WebSocket: ${e.message || "Inconnue"}`, "error");
      };
    } catch (e) {
      isConnecting.current = false;
      setStatus('Erreur');
      logEvent.add(`Exception WebSocket: ${e.message}`, "error");
    }
  };

  const stop = () => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
  };

  const sendHeartbeat = (maintaining) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'HEARTBEAT', data: { isMaintaining: maintaining } }));
    }
  };

  const sendAction = (type, data) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    } else {
        logEvent.add(`Impossible d'envoyer ${type}: non connecté`, "error");
    }
  };

  return { status, favorites, simulatedCoords, sendAction, connect };
}
