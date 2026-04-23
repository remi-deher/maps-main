import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { eventBus } from '../services/background';

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
        if (status !== 'Connecté') connect();
      }
      appState.current = nextAppState;
    });

    // Watchdog : Reconnexion cyclique
    const reconnectInterval = setInterval(() => {
      if (ip && status === 'Déconnecté' && !isConnecting.current) {
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
    if (!ip || isConnecting.current) return;
    stop();
    isConnecting.current = true;
    setStatus('Connexion...');

    try {
      ws.current = new WebSocket(`ws://${ip}:${port}`);
      ws.current.onopen = () => {
        isConnecting.current = false;
        setStatus('Connecté');
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
      ws.current.onclose = () => {
        isConnecting.current = false;
        setStatus('Déconnecté');
      };
      ws.current.onerror = () => {
        isConnecting.current = false;
        setStatus('Erreur');
      };
    } catch (e) {
      isConnecting.current = false;
      setStatus('Erreur');
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
    }
  };

  return { status, favorites, simulatedCoords, sendAction, connect };
}
