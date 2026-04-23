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
        deferredUpdatesInterval: 1500, // Plus fréquent pour empêcher la mise en veille iOS
        pausesLocationUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: { 
          notificationTitle: "GPS Mock Actif", 
          notificationBody: "Bouclier de connexion en cours...", 
          notificationColor: "#6366f1" 
        }
      });
      setIsMaintaining(true);
      return true;
    }
  };

  const searchAddress = async (query) => {
    if (!query || query.length < 3) return null;
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
      const data = await response.json();
      
      if (data && data.length > 0) {
        return {
          latitude: parseFloat(data[0].lat),
          longitude: parseFloat(data[0].lon),
          name: data[0].display_name.split(',')[0] // Nom court pour l'UI
        };
      }
      Alert.alert("Lieu introuvable", "Essayez d'être plus précis.");
      return null;
    } catch (e) {
      Alert.alert("Erreur réseau", "Impossible de contacter le service de recherche.");
      return null;
    } finally {
      setIsSearching(false);
    }
  };

  return { isMaintaining, isSearching, requestPermissions, toggleBackground, searchAddress };
}
