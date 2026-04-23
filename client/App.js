import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, Platform, TouchableOpacity, Text, Animated } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { CameraView, useCameraPermissions } from 'expo-camera';

// Modules locaux
import { COLORS, MAP_DARK_STYLE, SHADOWS } from './src/constants/theme';
import { useStorage } from './src/hooks/useStorage';
import { useSocket } from './src/hooks/useSocket';
import { useLocation } from './src/hooks/useLocation';
import Omnibar from './src/components/Omnibar';
import SettingsModal from './src/components/SettingsModal';
import { ActionPanel, FavoritesPanel, QuickFavorites } from './src/components/Panels';

export default function App() {
  const { serverIp, serverPort, saveSettings } = useStorage();
  const { isMaintaining, requestPermissions, toggleBackground, searchAddress } = useLocation();
  const { status, favorites, simulatedCoords, sendAction, connect } = useSocket(serverIp, serverPort, isMaintaining);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingCoords, setPendingCoords] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFavsOpen, setIsFavsOpen] = useState(false);

  const mapRef = useRef(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    requestPermissions();
    requestCameraPermission();
  }, []);

  const handleTeleport = (coords) => {
    sendAction('SET_LOCATION', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "" });
    setPendingCoords(null);
    setIsFavsOpen(false);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
  };

  const handleSearch = async () => {
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
      sendAction('REMOVE_FAVORITE', { lat: coords.latitude, lon: coords.longitude });
    } else {
      sendAction('ADD_FAVORITE', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "Lieu favori" });
    }
    // Note: On ne met pas à jour l'état local ici, on attend le retour du serveur (STATUS)
  };

  const handleScannerResult = ({ data }) => {
    setShowScanner(false);
    const match = data.match(/ws:\/\/([^:]+):(\d+)/);
    if (match) saveSettings(match[1], match[2]);
    else saveSettings(data, serverPort);
    connect();
  };

  if (showScanner) {
    return (
      <View style={styles.scanner}>
        <CameraView onBarcodeScanned={handleScannerResult} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}>
          <Text style={styles.closeText}>ANNULER</Text>
        </TouchableOpacity>
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
            provider={PROVIDER_GOOGLE}
            initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
            onLongPress={(e) => setPendingCoords({ ...e.nativeEvent.coordinate, name: "Position sélectionnée" })}
            customMapStyle={MAP_DARK_STYLE}
          >
            {simulatedCoords && (
              <Marker coordinate={simulatedCoords}>
                <View style={styles.marker}><View style={styles.pulse} /><View style={styles.dot} /></View>
              </Marker>
            )}
            {pendingCoords && <Marker coordinate={pendingCoords} pinColor={COLORS.error} />}
          </MapView>

          <Omnibar 
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={handleSearch}
            onScannerPress={() => setShowScanner(true)}
            onSettingsPress={() => setShowSettings(true)}
            status={status}
            isMaintaining={isMaintaining}
          />

          <View style={styles.floatingActions}>
            <TouchableOpacity style={[styles.floatBtn, isMaintaining && styles.activeFloat, SHADOWS.light]} onPress={toggleBackground}>
              <Text style={{fontSize: 22}}>{isMaintaining ? '🛡️' : '💤'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setIsFavsOpen(true)}>
              <Text style={{fontSize: 22}}>⭐</Text>
            </TouchableOpacity>
          </View>

          <QuickFavorites 
            visible={!pendingCoords}
            favorites={favorites} 
            onTeleport={handleTeleport} 
          />

          <ActionPanel 
            visible={!!pendingCoords} 
            coords={pendingCoords} 
            isFavorite={pendingCoords && favorites.some(f => Math.abs(f.lat - pendingCoords.latitude) < 0.0001 && Math.abs(f.lon - pendingCoords.longitude) < 0.0001)}
            onTeleport={handleTeleport}
            onToggleFavorite={handleToggleFavorite}
          />

          <FavoritesPanel 
            visible={isFavsOpen}
            favorites={favorites}
            onClose={() => setIsFavsOpen(false)}
            onTeleport={handleTeleport}
            onRemove={(f) => sendAction('REMOVE_FAVORITE', { lat: f.lat, lon: f.lon })}
          />

          <SettingsModal 
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            initialIp={serverIp}
            initialPort={serverPort}
            onSave={(ip, port) => { saveSettings(ip, port); setShowSettings(false); connect(); }}
          />
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scanner: { flex: 1, backgroundColor: '#000' },
  closeScanner: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: COLORS.primary, padding: 20, borderRadius: 30, ...SHADOWS.premium },
  closeText: { color: COLORS.text, fontWeight: 'bold' },
  marker: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.primary, opacity: 0.25 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: '#fff', ...SHADOWS.light },
  floatingActions: { position: 'absolute', top: 160, right: 15, gap: 12 },
  floatBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  activeFloat: { borderColor: COLORS.primary, backgroundColor: 'rgba(99,102,241,0.25)' }
});
