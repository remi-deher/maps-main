import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useStorage() {
  const [serverIp, setServerIp] = useState('');
  const [serverPort, setServerPort] = useState('8080');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedIp = await AsyncStorage.getItem('serverIp');
      const savedPort = await AsyncStorage.getItem('serverPort');
      if (savedIp) setServerIp(savedIp);
      if (savedPort) setServerPort(savedPort);
    } catch (e) {
      console.error("Erreur chargement settings:", e);
    }
  };

  const saveSettings = async (ip, port) => {
    try {
      await AsyncStorage.setItem('serverIp', ip);
      await AsyncStorage.setItem('serverPort', port);
      setServerIp(ip);
      setServerPort(port);
    } catch (e) {
      console.error("Erreur sauvegarde settings:", e);
    }
  };

  return { serverIp, serverPort, saveSettings };
}
