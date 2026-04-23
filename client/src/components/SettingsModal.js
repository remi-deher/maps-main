import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { COLORS } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SettingsModal({ visible, onClose, initialIp, initialPort, onSave }) {
  const [ip, setIp] = useState(initialIp);
  const [port, setPort] = useState(initialPort);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Configuration Serveur</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>ADRESSE IP</Text>
            <TextInput 
              style={styles.input} 
              value={ip} 
              onChangeText={setIp}
              placeholder="ex: 192.168.1.15"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>PORT</Text>
            <TextInput 
              style={styles.input} 
              value={port} 
              onChangeText={setPort}
              placeholder="8080"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>ANNULER</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.saveBtn} 
              onPress={() => onSave(ip, port)}
            >
              <Text style={styles.saveText}>APPLIQUER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  content: { width: SCREEN_WIDTH * 0.85, backgroundColor: COLORS.surface, borderRadius: 30, padding: 25 },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  inputGroup: { marginBottom: 15 },
  label: { fontSize: 10, color: COLORS.textMuted, fontWeight: '900', marginBottom: 5, marginLeft: 5 },
  input: { backgroundColor: COLORS.background, borderRadius: 15, padding: 15, color: COLORS.text, fontSize: 16 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center' },
  saveBtn: { flex: 2, backgroundColor: COLORS.primary, padding: 15, borderRadius: 15, alignItems: 'center' },
  cancelText: { color: COLORS.textSecondary, fontWeight: '700' },
  saveText: { color: COLORS.text, fontWeight: '900' }
});
