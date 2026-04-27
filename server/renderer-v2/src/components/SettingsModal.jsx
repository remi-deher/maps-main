import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, ShieldCheck, Settings } from 'lucide-react';

function SettingsModal({ isOpen, onClose }) {
  const [settings, setSettings] = useState({
    mapProvider: 'leaflet',
    googleMapsKey: '',
    companionPort: 8081,
    wifiIp: '',
    wifiPort: 32498,
    serverIp: '',
    usbDriver: 'go-ios',
    wifiDriver: 'pymobiledevice',
    fallbackEnabled: true
  });
  const [interfaces, setInterfaces] = useState([]);
  const [plistData, setPlistData] = useState({ plists: [], hasSelfIdentity: false });

  useEffect(() => {
    if (isOpen) {
      window.gps.getSettings().then(setSettings);
      window.gps.getNetworkInterfaces().then(setInterfaces);
      window.gps.listPlists().then(setPlistData);
    }
  }, [isOpen]);

  const handleSave = async () => {
    await window.gps.saveSettings(settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-xl glass-dark rounded-3xl shadow-2xl overflow-hidden border border-white/10"
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            Configuration
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
          {/* Interface Réseau */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Interface Réseau (WebSocket)</label>
            <div className="space-y-2">
              <p className="text-xs text-slate-500 px-1">Choisissez la carte réseau à utiliser pour la connexion iPhone</p>
              <select 
                value={settings.serverIp || ''}
                onChange={(e) => setSettings({...settings, serverIp: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors text-white appearance-none cursor-pointer"
              >
                <option value="" className="bg-slate-900">Auto-détection (recommandé)</option>
                {interfaces.map((iface, i) => (
                  <option key={i} value={iface.address} className="bg-slate-900">
                    {iface.name} — {iface.address}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Mode de fonctionnement */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Mode de fonctionnement</label>
            <div className="grid grid-cols-3 gap-3">
              <button 
                onClick={() => setSettings({...settings, operationMode: 'autonomous'})}
                className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.operationMode === 'autonomous' ? 'border-amber-500 bg-amber-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
              >
                <p className="font-bold text-xs">Autonome</p>
                <p className="text-[10px] opacity-50">PC Pur</p>
              </button>
              <button 
                onClick={() => setSettings({...settings, operationMode: 'client-server'})}
                className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.operationMode === 'client-server' ? 'border-purple-500 bg-purple-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
              >
                <p className="font-bold text-xs">Client/Serv</p>
                <p className="text-[10px] opacity-50">iPhone Requis</p>
              </button>
              <button 
                onClick={() => setSettings({...settings, operationMode: 'hybrid'})}
                className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.operationMode === 'hybrid' || !settings.operationMode ? 'border-blue-500 bg-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
              >
                <p className="font-bold text-xs">Hybride</p>
                <p className="text-[10px] opacity-50">Mixte (Défaut)</p>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 px-1 italic">
              {settings.operationMode === 'autonomous' && "💡 Le serveur WebSocket sera coupé. L'application iPhone ne pourra pas se connecter."}
              {settings.operationMode === 'client-server' && "💡 L'injection de position sera bloquée si aucun iPhone n'est connecté."}
              {settings.operationMode === 'hybrid' && "💡 Mode standard : injection libre, l'iPhone se connecte s'il le souhaite."}
            </p>
          </section>
          
          {/* Stabilisation iOS */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              Stabilisation iOS
            </label>
            <div className="flex items-center justify-between p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
              <div className="space-y-1 pr-4">
                <p className="text-sm font-bold text-white">Mode Éveil (Anti-Mise en veille)</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Simule un micro-mouvement (±1m) toutes les 30s. 
                  Indispensable pour empêcher iOS de "tuer" l'application lors d'une longue pause.
                </p>
              </div>
              <div 
                onClick={() => setSettings({...settings, isEveilMode: !settings.isEveilMode})}
                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${settings.isEveilMode ? 'bg-blue-600' : 'bg-slate-700'}`}
              >
                <motion.div 
                  animate={{ x: settings.isEveilMode ? 24 : 0 }}
                  className="w-4 h-4 bg-white rounded-full shadow-lg"
                />
              </div>
            </div>
          </section>

          {/* Map Provider */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Moteur de carte</label>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setSettings({...settings, mapProvider: 'leaflet'})}
                className={`p-4 rounded-2xl border-2 transition-all ${settings.mapProvider === 'leaflet' ? 'border-blue-500 bg-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
              >
                <p className="font-bold">Leaflet</p>
                <p className="text-xs opacity-50 text-slate-300">OpenStreetMap (Gratuit)</p>
              </button>
              <button 
                onClick={() => setSettings({...settings, mapProvider: 'google'})}
                className={`p-4 rounded-2xl border-2 transition-all ${settings.mapProvider === 'google' ? 'border-blue-500 bg-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
              >
                <p className="font-bold">Google Maps</p>
                <p className="text-xs opacity-50 text-slate-300">Nécessite une clé API</p>
              </button>
            </div>
            {settings.mapProvider === 'google' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="pt-2">
                <input 
                  type="password" 
                  value={settings.googleMapsKey}
                  onChange={(e) => setSettings({...settings, googleMapsKey: e.target.value})}
                  placeholder="Clé API Google Maps"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                />
              </motion.div>
            )}
          </section>

          {/* Network Settings */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Réglages avancés (Connexion iPhone)</label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <p className="text-xs text-slate-500 px-1">Adresse IP de l'iPhone (Force Override)</p>
                <input 
                  type="text" 
                  value={settings.wifiIp}
                  onChange={(e) => setSettings({...settings, wifiIp: e.target.value})}
                  placeholder="ex: 192.168.1.15 (Laisser vide pour auto)"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-slate-500 px-1">Port WebSocket (PC)</p>
                <input 
                  type="number" 
                  value={settings.companionPort}
                  onChange={(e) => setSettings({...settings, companionPort: parseInt(e.target.value)})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-slate-500 px-1">Port RSD (iPhone)</p>
                <input 
                  type="number" 
                  value={settings.wifiPort}
                  onChange={(e) => setSettings({...settings, wifiPort: parseInt(e.target.value)})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
          </section>

          {/* Driver Selection */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Moteurs de connexion (Drivers)</label>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 px-1">Mode USB</p>
                  <select 
                    value={settings.usbDriver}
                    onChange={(e) => setSettings({...settings, usbDriver: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors text-white appearance-none cursor-pointer"
                  >
                    <option value="go-ios" className="bg-slate-900">go-ios (Recommandé)</option>
                    <option value="pymobiledevice" className="bg-slate-900">pymobiledevice3</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 px-1">Mode WiFi</p>
                  <select 
                    value={settings.wifiDriver}
                    onChange={(e) => setSettings({...settings, wifiDriver: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors text-white appearance-none cursor-pointer"
                  >
                    <option value="pymobiledevice" className="bg-slate-900">pymobiledevice3 (Défaut)</option>
                    <option value="go-ios" className="bg-slate-900">go-ios</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                <input 
                  type="checkbox"
                  checked={settings.fallbackEnabled}
                  onChange={(e) => setSettings({...settings, fallbackEnabled: e.target.checked})}
                  className="w-4 h-4 rounded border-white/10 bg-white/5"
                />
                <div>
                  <p className="text-sm font-bold text-white">Activer le basculement automatique</p>
                  <p className="text-[10px] text-slate-500">Tente l'autre driver si le préféré échoue.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Enrôlement Manuel */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              Enrôlement Manuel (.plist)
            </label>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs text-slate-400">
                Si vous ne pouvez pas utiliser l'application mobile pour l'enrôlement, 
                vous pouvez importer manuellement vos fichiers <code className="text-blue-400">selfIdentity.plist</code> 
                et <code className="text-blue-400">[UDID].plist</code>.
              </p>
              <div className="flex gap-2">
                <input 
                  type="file" 
                  accept=".plist"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files);
                    for (const file of files) {
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const res = await window.gps.importPlist({
                          name: file.name,
                          content: event.target.result
                        });
                        if (res.success) {
                          alert(`Fichier ${file.name} importé avec succès !`);
                        } else {
                          alert(`Erreur pour ${file.name}: ${res.error}`);
                        }
                      };
                      reader.readAsText(file);
                    }
                  }}
                  className="block w-full text-sm text-slate-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-xl file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-600 file:text-white
                    hover:file:bg-blue-500
                    cursor-pointer"
                />
              </div>
            </div>
          </section>

          {/* Liste des Certificats */}
          <section className="space-y-4">
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Certificats Installés</span>
              <button 
                onClick={() => {
                  window.gps.listPlists().then(res => {
                    if (res.success) {
                      setPlistData(res);
                    }
                  });
                }}
                className="text-[10px] text-blue-400 hover:underline"
              >
                Actualiser
              </button>
            </label>
            <div className="space-y-2">
              {/* Serveur Key */}
              <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${plistData.hasSelfIdentity ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-sm font-bold">Identité Serveur</p>
                    <p className="text-[10px] text-slate-500">selfIdentity.plist</p>
                  </div>
                </div>
                <button 
                  onClick={async () => {
                    if (confirm("Voulez-vous vraiment réinitialiser l'identité du serveur ? Cela cassera le jumelage avec tous les iPhones.")) {
                      await window.gps.deletePlist('selfIdentity.plist');
                      const res = await window.gps.listPlists();
                      setPlistData(res);
                    }
                  }}
                  className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold rounded-lg transition-colors"
                >
                  {plistData.hasSelfIdentity ? 'Réinitialiser' : 'Manquant'}
                </button>
              </div>

              {/* Liste UDIDs */}
              <div className="max-h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {plistData.plists && plistData.plists.length > 0 ? (
                  plistData.plists.map((name, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500/50" />
                        <div>
                          <p className="text-[11px] font-medium text-slate-300">iPhone UDID</p>
                          <p className="text-[10px] text-slate-500 font-mono">{name.replace('.plist', '')}</p>
                        </div>
                      </div>
                      <button 
                        onClick={async () => {
                          if (confirm(`Supprimer le certificat pour ${name} ?`)) {
                            await window.gps.deletePlist(name);
                            const res = await window.gps.listPlists();
                            setPlistData(res);
                          }
                        }}
                        className="p-2 hover:bg-white/10 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-center py-4 text-xs text-slate-600 italic">Aucun iPhone jumelé</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="p-6 bg-white/5 border-t border-white/5 flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl font-bold hover:bg-white/10 transition-colors text-slate-400">
            Annuler
          </button>
          <button 
            onClick={handleSave}
            className="flex-1 h-12 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            Enregistrer
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default SettingsModal;
