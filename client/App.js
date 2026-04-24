import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, Platform, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Battery from 'expo-battery';

// Modules locaux
import { COLORS, SHADOWS } from './src/constants/theme';
import { useStorage } from './src/hooks/useStorage';
import { useSocket } from './src/hooks/useSocket';
import { useLocation } from './src/hooks/useLocation';
import { logEvent } from './src/services/logger';
import Omnibar from './src/components/Omnibar';
import SettingsModal from './src/components/SettingsModal';
import DebugModal from './src/components/DebugModal';
import { ActionPanel, FavoritesPanel, QuickFavorites } from './src/components/Panels';

export default function App() {
  // Hooks de logique
  const { serverIp, serverPort, saveSettings } = useStorage();
  const { isMaintaining, requestPermissions, toggleBackground, searchAddress, reverseGeocode } = useLocation();
  const { 
    status, favorites, recentHistory, simulatedCoords, 
    deviceInfo, connectionType, rsdAddress, 
    sendAction, connect 
  } = useSocket(serverIp, serverPort, isMaintaining);
  
  // États UI locaux
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingCoords, setPendingCoords] = useState(null);
  const [simulatedAddress, setSimulatedAddress] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isFavsOpen, setIsFavsOpen] = useState(false);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [mapType, setMapType] = useState('hybrid');

  const mapRef = useRef(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    logEvent.add("Application démarrée");
    requestPermissions();
    requestCameraPermission();

    // Surveillance de la batterie / mode économie
    const checkBattery = async () => {
      const isLowPower = await Battery.isLowPowerModeEnabledAsync();
      setIsLowPowerMode(isLowPower);
    };
    checkBattery();
    const batterySub = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
      setIsLowPowerMode(lowPowerMode);
      if (lowPowerMode) logEvent.add("⚠️ Mode économie d'énergie activé ! Connexion WiFi instable.");
    });

    return () => batterySub.remove();
  }, []);

  // Géocodage inverse automatique pour la Pill + Centrage auto
  useEffect(() => {
    if (simulatedCoords) {
      reverseGeocode(simulatedCoords.latitude, simulatedCoords.longitude).then(setSimulatedAddress);
      // Auto-centrage lors d'une mise à jour distante (PC -> iPhone)
      mapRef.current?.animateToRegion({ ...simulatedCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
    } else {
      setSimulatedAddress(null);
    }
  }, [simulatedCoords]);

  // Actions
  const handleTeleport = (coords) => {
    logEvent.add(`Téléportation vers: ${coords.latitude}, ${coords.longitude}`);
    sendAction('SET_LOCATION', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "" });
    setPendingCoords(null);
    setIsFavsOpen(false);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
  };

  const handleSearch = async () => {
    logEvent.add(`Recherche: ${searchQuery}`);
    const coords = await searchAddress(searchQuery);
    if (coords) {
      setPendingCoords(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
    }
    Keyboard.dismiss();
  };

  const handleToggleFavorite = (coords) => {
    const exists = favorites.some(f => Math.abs(f.lat - coords.latitude) < 0.0001 && Math.abs(f.lon - coords.longitude) < 0.0001);
    if (exists) {
      logEvent.add("Suppression favori...");
      sendAction('REMOVE_FAVORITE', { lat: coords.latitude, lon: coords.longitude });
    } else {
      logEvent.add("Ajout favori...");
      sendAction('ADD_FAVORITE', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "Lieu favori" });
    }
  };
  
  const centerOnLocation = async () => {
    if (simulatedCoords) {
      logEvent.add("Centrage sur position simulée");
      mapRef.current?.animateToRegion({ ...simulatedCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
    } else {
      logEvent.add("Centrage sur position réelle");
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion({ 
        latitude: loc.coords.latitude, 
        longitude: loc.coords.longitude, 
        latitudeDelta: 0.005, 
        longitudeDelta: 0.005 
      }, 500);
    }
  };

  const toggleMapType = () => {
    setMapType(prev => prev === 'hybrid' ? 'standard' : 'hybrid');
  };

  const handleScannerResult = ({ data }) => {
    setShowScanner(false);
    logEvent.add(`QR Scanné: ${data}`);
    const match = data.match(/ws:\/\/([^:]+):(\d+)/);
    if (match) {
        logEvent.add(`Config extraite: ${match[1]}:${match[2]}`);
        saveSettings(match[1], match[2]);
    } else {
        logEvent.add(`Pas de pattern ws://, utilisation brute: ${data}`);
        saveSettings(data, serverPort);
    }
    // La reconnexion sera automatique via le watchdog car serverIp a changé
  };

  // Rendu Scanner
  if (showScanner) {
    return (
      <View style={styles.scanner}>
        <CameraView onBarcodeScanned={handleScannerResult} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}><Text style={styles.closeText}>ANNULER</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            mapType={mapType}
            initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
            onLongPress={async (e) => {
              const coords = e.nativeEvent.coordinate;
              setPendingCoords({ ...coords, name: "Recherche..." });
              const address = await reverseGeocode(coords.latitude, coords.longitude);
              setPendingCoords({ ...coords, name: address });
            }}
          >
            {simulatedCoords && (
              <Marker coordinate={simulatedCoords}>
                <View style={styles.marker}><View style={styles.pulse} /><View style={styles.dot} /></View>
              </Marker>
            )}
            {pendingCoords && <Marker coordinate={pendingCoords} pinColor={COLORS.error} />}
          </MapView>

          <View style={styles.omnibarContainer}>
            <Omnibar 
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={handleSearch}
                onScannerPress={() => setShowScanner(true)}
                onSettingsPress={() => setShowSettings(true)}
                onDebugPress={() => setShowDebug(true)}
                onSuggestionSelect={(coords) => {
                  setPendingCoords(coords);
                  mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
                  setSearchQuery('');
                }}
                status={status}
                isMaintaining={isMaintaining}
                isLowPowerMode={isLowPowerMode}
            />
          </View>

          <View style={styles.floatingActions}>
            <TouchableOpacity style={[styles.floatBtn, isMaintaining && styles.activeFloat, SHADOWS.light]} onPress={toggleBackground}>
              <Text style={{fontSize: 22}}>{isMaintaining ? '🛡️' : '💤'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setIsFavsOpen(true)}>
              <Text style={{fontSize: 22}}>⭐</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={toggleMapType}>
              <Text style={{fontSize: 22}}>{mapType === 'hybrid' ? '🗺️' : '🛰️'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={centerOnLocation}>
              <Text style={{fontSize: 22}}>🎯</Text>
            </TouchableOpacity>
          </View>

          <QuickFavorites 
            favorites={favorites} 
            onTeleport={handleTeleport} 
            visible={!pendingCoords && !isFavsOpen} 
          />

          {simulatedCoords && (
            <TouchableOpacity 
              style={[styles.simPill, SHADOWS.premium]} 
              activeOpacity={0.8}
              onPress={centerOnSimulation}
            >
              <View style={styles.simPillIcon}><Text style={{fontSize: 12}}>🚀</Text></View>
              <Text style={styles.simPillText} numberOfLines={1}>
                {simulatedAddress || "Simulation en cours..."}
              </Text>
            </TouchableOpacity>
          )}

          <ActionPanel 
            visible={!!pendingCoords} 
            coords={pendingCoords} 
            isFavorite={pendingCoords && favorites.some(f => Math.abs(f.lat - pendingCoords.latitude) < 0.0001 && Math.abs(f.lon - pendingCoords.longitude) < 0.0001)}
            onTeleport={handleTeleport}
            onToggleFavorite={handleToggleFavorite}
            onClose={() => setPendingCoords(null)}
          />

          <FavoritesPanel 
            visible={isFavsOpen}
            favorites={favorites}
            history={recentHistory}
            onClose={() => setIsFavsOpen(false)}
            onTeleport={handleTeleport}
            onRemove={(f) => sendAction('REMOVE_FAVORITE', { lat: f.lat, lon: f.lon })}
            onRename={(lat, lon, newName) => sendAction('RENAME_FAVORITE', { lat, lon, newName })}
          />

          <SettingsModal 
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            initialIp={serverIp}
            initialPort={serverPort}
            status={status}
            deviceInfo={deviceInfo}
            connectionType={connectionType}
            rsdAddress={rsdAddress}
            onSave={(ip, port) => { 
                logEvent.add(`Config manuelle: ${ip}:${port}`);
                saveSettings(ip, port); 
                setShowSettings(false); 
                connect(); 
            }}
          />

          <DebugModal 
            visible={showDebug} 
            onClose={() => setShowDebug(false)} 
          />
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  omnibarContainer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  scanner: { flex: 1, backgroundColor: '#000' },
  closeScanner: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: COLORS.primary, padding: 20, borderRadius: 30 },
  closeText: { color: COLORS.text, fontWeight: 'bold' },
  marker: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary, opacity: 0.2 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: '#fff' },
  floatingActions: { position: 'absolute', top: 160, right: 15, gap: 10 },
  floatBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  activeFloat: { borderColor: COLORS.primary, backgroundColor: 'rgba(99,102,241,0.3)' },
  simPill: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 20,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    zIndex: 90
  },
  simPillIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(99, 102, 241, 0.2)',
    justifyContent: 'center', alignItems: 'center'
  },
  simPillText: { color: COLORS.text, fontSize: 14, fontWeight: '700', flex: 1 }
});
