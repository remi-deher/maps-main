import { useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { useAppStore } from '../store/useAppStore';
import { LOCATION_TASK_NAME } from '../services/background';
import { Coords } from '../types';

export const useLocation = () => {
  const store = useAppStore();

  const requestPermissions = useCallback(async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') return false;
    
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    return bg === 'granted';
  }, []);

  const toggleBackground = useCallback(async () => {
    if (store.isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      store.setIsMaintaining(false);
    } else {
      const hasPerm = await requestPermissions();
      if (!hasPerm) return;
      
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 5000,
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Simulation active",
          notificationBody: "Le tunnel est maintenu en arrière-plan",
          notificationColor: "#6366f1"
        }
      });
      store.setIsMaintaining(true);
    }
  }, [store.isMaintaining, requestPermissions]);

  const searchAddress = useCallback(async (query: string): Promise<Coords | null> => {
    if (!query) return null;
    try {
      const result = await Location.geocodeAsync(query);
      if (result.length > 0) {
        return {
          latitude: result[0].latitude,
          longitude: result[0].longitude,
          name: query
        };
      }
    } catch (e) {}
    return null;
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    try {
      const result = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (result.length > 0) {
        const item = result[0];
        return `${item.name || ''} ${item.street || ''}, ${item.city || ''}`.trim();
      }
    } catch (e) {}
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }, []);

  return {
    isMaintaining: store.isMaintaining,
    requestPermissions,
    toggleBackground,
    searchAddress,
    reverseGeocode
  };
};
