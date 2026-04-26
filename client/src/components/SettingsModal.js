'use strict'

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export default function SettingsModal({ 
  visible, onClose, initialIp, initialPort, onSave, onImportGpx,
  status, deviceInfo, connectionType, rsdAddress 
}) {
  const [ip, setIp] = useState(initialIp);
  const [port, setPort] = useState(initialPort);

  const handlePickGpx = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/gpx+xml',
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const fileUri = result.assets[0].uri;
        const content = await FileSystem.readAsStringAsync(fileUri);
        onImportGpx(content);
        onClose();
      }
    } catch (err) {
      console.error("Erreur lors du choix du GPX:", err);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Paramètres</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>ADRESSE IP SERVEUR</Text>
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

          <View style={styles.inputGroup}>
            <Text style={styles.label}>NAVIGATION</Text>
            <TouchableOpacity style={styles.gpxBtn} onPress={handlePickGpx}>
              <Text style={styles.gpxBtnText}>📁 IMPORTER PARCOURS (.GPX)</Text>
            </TouchableOpacity>
          </View>

          {/* SECTION STATUS CONNEXION */}
          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>ETAT DE LA CONNEXION</Text>
            
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: status === 'Connecté' ? COLORS.success : COLORS.error }]} />
              <Text style={styles.statusText}>{status}</Text>
              <Text style={styles.connectionType}>{connectionType ? `(${connectionType})` : ''}</Text>
            </View>

            {status === 'Connecté' && (
              <View style={styles.detailsBox}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>RSD Serveur:</Text>
                  <Text style={styles.detailValue}>{rsdAddress || 'N/A'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Modèle:</Text>
                  <Text style={styles.detailValue}>{deviceInfo?.type || 'iPhone'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>iOS:</Text>
                  <Text style={styles.detailValue}>{deviceInfo?.version || '?'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Appairage:</Text>
                  <Text style={[styles.detailValue, { color: deviceInfo?.paired ? COLORS.success : COLORS.warning }]}>
                    {deviceInfo?.paired ? 'VALIDE' : 'NON (DVT)'}
                  </Text>
                </View>
              </View>
            )}
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  content: { width: SCREEN_WIDTH * 0.85, backgroundColor: COLORS.surface, borderRadius: 30, padding: 25 },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  inputGroup: { marginBottom: 15 },
  label: { fontSize: 10, color: COLORS.textMuted, fontWeight: '900', marginBottom: 5, marginLeft: 5 },
  input: { backgroundColor: COLORS.background, borderRadius: 15, padding: 15, color: COLORS.text, fontSize: 16 },
  gpxBtn: { backgroundColor: 'rgba(99, 102, 241, 0.1)', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 15, padding: 15, alignItems: 'center' },
  gpxBtnText: { color: COLORS.primary, fontWeight: '900', fontSize: 12 },
  
  statusBox: { 
    backgroundColor: COLORS.background, 
    borderRadius: 20, 
    padding: 15, 
    marginTop: 5, 
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  statusLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: '900', marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  connectionType: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  
  detailsBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 10, gap: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: COLORS.textMuted, fontSize: 11 },
  detailValue: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center' },
  saveBtn: { flex: 2, backgroundColor: COLORS.primary, padding: 15, borderRadius: 15, alignItems: 'center' },
  cancelText: { color: COLORS.textSecondary, fontWeight: '700' },
  saveText: { color: COLORS.text, fontWeight: '900' }
});
