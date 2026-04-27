import React, { useState, useEffect } from 'react';
// App.tsx (v1.2.4-task-registration-fix)
import { View, ActivityIndicator, Text, StyleSheet, Alert } from 'react-native';
import { COLORS } from './src/constants/theme';
import { initServices } from './src/services/init';
import { useAppStore } from './src/store/useAppStore';
import AppContainer from './src/AppContainer';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const store = useAppStore();

  useEffect(() => {
    async function prepare() {
      try {
        console.log("[APP] Préparation...");
        await initServices();
        await store.loadSettings();
        store.connect();
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(e);
      } finally {
        setIsReady(true);
      }
    }
    prepare();

    return () => {
      store.disconnect();
    };
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Démarrage du système...</Text>
      </View>
    );
  }

  return <AppContainer />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.8
  }
});
