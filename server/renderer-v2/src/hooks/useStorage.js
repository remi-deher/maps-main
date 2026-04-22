import { useState, useEffect } from 'react';

export function useStorage() {
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    // Initial load
    const loadData = async () => {
      const settings = await window.gps.getSettings() || {};
      setHistory(settings.history || []);
      setFavorites(settings.favorites || []);
    };
    loadData();
  }, []);

  const addToHistory = async (item) => {
    const newHistory = [item, ...history.filter(h => h.lat !== item.lat || h.lon !== item.lon)].slice(0, 50);
    setHistory(newHistory);
    const settings = await window.gps.getSettings();
    await window.gps.saveSettings({ ...settings, history: newHistory });
  };

  const addFavorite = async (item) => {
    const newFavorites = [...favorites, item];
    setFavorites(newFavorites);
    const settings = await window.gps.getSettings();
    await window.gps.saveSettings({ ...settings, favorites: newFavorites });
  };

  const removeFavorite = async (index) => {
    const newFavorites = favorites.filter((_, i) => i !== index);
    setFavorites(newFavorites);
    const settings = await window.gps.getSettings();
    await window.gps.saveSettings({ ...settings, favorites: newFavorites });
  };

  return { history, favorites, addToHistory, addFavorite, removeFavorite };
}
