import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, Modal, SafeAreaView, Platform } from 'react-native';
import { COLORS } from '../constants/theme';
import { logEvent } from '../services/logger';

export default function DebugModal({ visible, onClose }) {
  const [logs, setLogs] = useState(logEvent.history);

  useEffect(() => {
    const unsubscribe = logEvent.subscribe(setLogs);
    return () => unsubscribe();
  }, []);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <SafeAreaView style={styles.header}>
          <Text style={styles.title}>Journal de Diagnostic</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>FERMER</Text>
          </TouchableOpacity>
        </SafeAreaView>

        <ScrollView style={styles.logList} contentContainerStyle={{ padding: 15 }}>
          {logs.map((log) => (
            <View key={log.id} style={styles.logEntry}>
              <Text style={styles.timestamp}>{log.timestamp}</Text>
              <Text style={[
                styles.message,
                log.type === 'error' && { color: COLORS.error },
                log.type === 'success' && { color: COLORS.success }
              ]}>
                {log.message}
              </Text>
            </View>
          ))}
          {logs.length === 0 && <Text style={styles.empty}>Aucun événement enregistré.</Text>}
        </ScrollView>

        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => { logEvent.history = []; setLogs([]); }}
        >
          <Text style={styles.clearText}>EFFACER TOUT</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155'
  },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  closeBtn: { padding: 10, backgroundColor: COLORS.primary, borderRadius: 10 },
  closeText: { color: '#fff', fontWeight: 'bold' },
  logList: { flex: 1 },
  logEntry: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  timestamp: { color: '#64748b', fontSize: 10, fontWeight: 'bold', marginBottom: 2 },
  message: { color: '#cbd5e1', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  empty: { color: '#475569', textAlign: 'center', marginTop: 100 },
  clearBtn: { margin: 20, padding: 15, alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 15 },
  clearText: { color: '#94a3b8', fontWeight: 'bold' }
});
