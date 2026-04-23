import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from '../services/background';

export function useLocation() {
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const requestPermissions = async () => {
    await Location.requestForegroundPermissionsAsync();
  };

  const toggleBackground = async () => {
    if (isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsMaintaining(false);
      return false;
    } else {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission", "Accès à la position en arrière-plan requis.");
        return false;
      }
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 1,
        deferredUpdatesInterval: 5000,
        foregroundService: { 
          notificationTitle: "GPS Mock Active", 
          notificationBody: "Maintien de la connexion...", 
          notificationColor: "#6366f1" 
        }
      });
      setIsMaintaining(true);
      return true;
    }
  };

  const searchAddress = async (query) => {
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(query);
      return results.length > 0 ? {
        latitude: results[0].latitude,
        longitude: results[0].longitude,
        name: query
      } : null;
    } catch (e) {
      Alert.alert("Erreur", "Lieu introuvable.");
      return null;
    } finally {
      setIsSearching(false);
    }
  };

  return { isMaintaining, isSearching, requestPermissions, toggleBackground, searchAddress };
}
