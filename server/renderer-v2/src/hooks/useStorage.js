import { useState, useEffect } from 'react';

export function useStorage() {
  const [recentHistory, setRecentHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    // Initial load
    const loadData = async () => {
      const settings = await window.gps.getSettings() || {};
      setRecentHistory(settings.recentHistory || []);
      setFavorites(settings.favorites || []);
    };
    loadData();

    // Listen for real-time updates from server/mobile
    const removeListener = window.gps.onStatus((data) => {
      if (data.service === 'favorites') setFavorites(data.data);
      if (data.service === 'history') setRecentHistory(data.data);
    });

    return () => removeListener();
  }, []);

  const addToHistory = async (item) => {
    const settings = await window.gps.getSettings();
    let history = settings.recentHistory || [];
    if (history.length > 0 && history[0].name === item.name) return;
    history = [item, ...history].slice(0, 20);
    await window.gps.saveSettings({ ...settings, recentHistory: history });
    setRecentHistory(history);
  };

  const addFavorite = async (item) => {
    const settings = await window.gps.getSettings();
    const newFavorites = [item, ...(settings.favorites || [])];
    await window.gps.saveSettings({ ...settings, favorites: newFavorites });
    setFavorites(newFavorites);
  };

  const removeFavorite = async (lat, lon) => {
    const settings = await window.gps.getSettings();
    const newFavorites = (settings.favorites || []).filter(f => Math.abs(f.lat - lat) > 0.0001 || Math.abs(f.lon - lon) > 0.0001);
    await window.gps.saveSettings({ ...settings, favorites: newFavorites });
    setFavorites(newFavorites);
  };

  return { history: recentHistory, favorites, addToHistory, addFavorite, removeFavorite };
}
