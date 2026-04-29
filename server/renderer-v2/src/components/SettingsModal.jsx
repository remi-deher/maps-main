import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, ShieldCheck, Settings, Activity, Terminal, Globe, Cpu, Smartphone, RefreshCw, Trash2, Search, Play, Pause, AlertTriangle } from 'lucide-react';

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
    fallbackEnabled: true,
    clusterMode: 'off',
    clusterNodes: [],
    serverName: ''
  });
  const [activeTab, setActiveTab] = useState('general');
  const [diagLogs, setDiagLogs] = useState('');
  const [isDiagRunning, setIsDiagRunning] = useState(false);
  const [manualDrivers, setManualDrivers] = useState({ pmd3: false, goios: false });
  const [newPeer, setNewPeer] = useState({ address: '', port: '8080' });
  const [clusterDashboard, setClusterDashboard] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [plistData, setPlistData] = useState({ plists: [], hasSelfIdentity: false });

  const runDiagnostic = async (type) => {
    setIsDiagRunning(true);
    setDiagLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] Lancement scan ${type.toUpperCase()}...\n`);
    try {
      const res = await window.gps.runDiag(type);
      setDiagLogs(prev => prev + res.output + '\n-------------------\n');
    } catch (e) {
      setDiagLogs(prev => prev + `\n[ERREUR] ${e.message}\n`);
    }
    setIsDiagRunning(false);
  };

  const toggleDriver = async (id) => {
    const isActivating = !manualDrivers[id];
    setManualDrivers(prev => ({ ...prev, [id]: isActivating }));
    
    setDiagLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] ${isActivating ? '⚡ Démarrage' : '🛑 Arrêt'} manuel : ${id}...\n`);
    
    try {
      if (isActivating) {
        await window.gps.startDriver(id);
      } else {
        await window.gps.stopDriver(id);
      }
    } catch (e) {
      setDiagLogs(prev => prev + `\n[ERREUR] ${e.message}\n`);
      setManualDrivers(prev => ({ ...prev, [id]: !isActivating }));
    }
  };

  const handleManualModeToggle = async () => {
    const newVal = !settings.manualTunnelMode;
    const updated = { ...settings, manualTunnelMode: newVal };
    setSettings(updated);
    
    if (!newVal) {
      setDiagLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] ♻️ Reprise de contrôle par le serveur. Nettoyage...\n`);
      setManualDrivers({ pmd3: false, goios: false });
      await window.gps.stopTunnels();
    }
    await window.gps.saveSettings(updated);
  };

  const stopAllTunnels = async () => {
    setIsDiagRunning(true);
    setDiagLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] 🛑 Demande d'arrêt forcé de tous les tunnels...\n`);
    try {
      const res = await window.gps.stopTunnels();
      setDiagLogs(prev => prev + res.output + '\n-------------------\n');
    } catch (e) {
      setDiagLogs(prev => prev + `\n[ERREUR] ${e.message}\n`);
    }
    setIsDiagRunning(false);
  };

  const forceStartDriver = async (id) => {
    setIsDiagRunning(true);
    setDiagLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] ⚡ Tentative de démarrage forcé : ${id}...\n`);
    try {
      const res = await window.gps.startDriver(id);
      setDiagLogs(prev => prev + res.output + '\n-------------------\n');
    } catch (e) {
      setDiagLogs(prev => prev + `\n[ERREUR] ${e.message}\n`);
    }
    setIsDiagRunning(false);
  };

  useEffect(() => {
    if (isOpen) {
      window.gps.getSettings().then(setSettings);
      
      // Écoute des logs de diagnostic en temps réel
      if (window.gps.onEvent) {
        window.gps.onEvent('diag-log', (data) => {
          setDiagLogs(prev => prev + `[${data.driverId}] ${data.msg}\n`);
        });
      }

      window.gps.getNetworkInterfaces().then(setInterfaces);
      window.gps.listPlists().then(setPlistData);
    }

    const unSubStatus = window.gps.onStatus((payload) => {
      if (payload.service === 'cluster-dashboard') {
        setClusterDashboard(payload.data);
      }
    });

    const unSubSettings = window.gps.onSettingsUpdated((newSettings) => {
      setSettings(newSettings);
    });

    return () => {
      unSubStatus();
      unSubSettings();
    };
  }, [isOpen]);

  const handleSave = async () => {
    await window.gps.saveSettings(settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
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
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setActiveTab('general')}
              className={`text-lg font-bold flex items-center gap-2 pb-1 border-b-2 transition-all ${activeTab === 'general' ? 'border-blue-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              <Settings className="w-5 h-5" />
              Général
            </button>
            <button 
              onClick={() => setActiveTab('cluster')}
              className={`text-lg font-bold flex items-center gap-2 pb-1 border-b-2 transition-all ${activeTab === 'cluster' ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              <ShieldCheck className="w-5 h-5" />
              Cluster (HA)
            </button>
            <button 
              onClick={() => setActiveTab('diag')}
              className={`text-lg font-bold flex items-center gap-2 pb-1 border-b-2 transition-all ${activeTab === 'diag' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              <Activity className="w-5 h-5" />
              Diag
            </button>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
          {activeTab === 'general' && (
            <>
              {/* Contenu Général existant... */}
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

          {/* Mode Manuel / Maintenance */}
          <section className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
              <div className="space-y-1 pr-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <p className="text-sm font-bold text-white">Mode Manuel (Diagnostic)</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Désactive la relance automatique du tunnel. Utile pour tester des commandes manuellement.
                </p>
              </div>
              <div 
                onClick={() => setSettings({...settings, manualTunnelMode: !settings.manualTunnelMode})}
                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${settings.manualTunnelMode ? 'bg-amber-600' : 'bg-slate-700'}`}
              >
                <motion.div 
                  animate={{ x: settings.manualTunnelMode ? 24 : 0 }}
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
            <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Moteur de connexion (Driver unique)</label>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs text-slate-500 px-1">Choisissez l'outil de tunneling global (USB & WiFi)</p>
                <select 
                  value={settings.preferredDriver}
                  onChange={(e) => setSettings({...settings, preferredDriver: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors text-white appearance-none cursor-pointer"
                >
                  <option value="go-ios" className="bg-slate-900">go-ios (Recommandé - Rapide & Stable)</option>
                  <option value="pymobiledevice" className="bg-slate-900">pymobiledevice3 (Défaut - Complet)</option>
                </select>
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
                  <p className="text-[10px] text-slate-500">Tente l'autre driver si le préféré ne trouve rien après 30s.</p>
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
                        const content = event.target.result; // C'est une DataURL (base64)
                        const res = await window.gps.importPlist({
                          name: file.name,
                          content: content
                        });
                        if (res.success) {
                          alert(`Fichier ${file.name} importé avec succès !`);
                        } else {
                          alert(`Erreur pour ${file.name}: ${res.error}`);
                        }
                      };
                      reader.readAsDataURL(file);
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
            </>
          )}

          {activeTab === 'cluster' && (
            <div className="space-y-8">
              {/* Identification */}
              <section className="space-y-4">
                <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Identification du serveur local</label>
                <div className="flex gap-3">
                  <input 
                    type="text" 
                    placeholder="Nom du serveur (ex: PC Salon, Mac Bureau...)"
                    value={settings.serverName || ''}
                    onChange={(e) => setSettings({...settings, serverName: e.target.value})}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-purple-500"
                  />
                </div>
              </section>

              {/* Mode Cluster */}
              <section className="space-y-4">
                <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Mode de fonctionnement</label>
                <div className="grid grid-cols-3 gap-3">
                  <button 
                    onClick={() => setSettings({...settings, clusterMode: 'off'})}
                    className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.clusterMode === 'off' ? 'border-slate-500 bg-slate-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                  >
                    <p className="font-bold text-xs">Désactivé</p>
                    <p className="text-[10px] opacity-50">Mode Solo</p>
                  </button>
                  <button 
                    onClick={() => setSettings({...settings, clusterMode: 'auto'})}
                    className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.clusterMode === 'auto' ? 'border-purple-500 bg-purple-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                  >
                    <p className="font-bold text-xs">Auto (HA)</p>
                    <p className="text-[10px] opacity-50">Basculement 30s</p>
                  </button>
                  <button 
                    onClick={() => setSettings({...settings, clusterMode: 'standalone'})}
                    className={`p-3 rounded-2xl border-2 transition-all text-center flex flex-col items-center gap-1 ${settings.clusterMode === 'standalone' ? 'border-blue-500 bg-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                  >
                    <p className="font-bold text-xs">Manuel</p>
                    <p className="text-[10px] opacity-50">Synchro seule</p>
                  </button>
                </div>
              </section>

              {/* Tableau de bord du Cluster */}
              {settings.clusterMode !== 'off' && (
                <section className="space-y-4">
                  <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Tableau de bord du Cluster (Temps réel)</label>
                  <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/5 text-slate-500 font-bold uppercase tracking-tighter">
                        <tr>
                          <th className="px-4 py-3">Serveur</th>
                          <th className="px-4 py-3">Rôle</th>
                          <th className="px-4 py-3">Mode</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {/* Ce serveur */}
                        <tr className="bg-purple-500/10">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                              <span className="font-bold text-white">{settings.serverName || 'Ce PC (Local)'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${clusterDashboard?.role === 'master' ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                              {clusterDashboard?.role?.toUpperCase() || 'OFFLINE'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-400">{settings.clusterMode}</td>
                          <td className="px-4 py-3 text-right">
                             <span className="text-[10px] text-purple-400 italic">Moi</span>
                          </td>
                        </tr>
                        {/* Les pairs */}
                        {clusterDashboard?.peers?.map((peer, i) => (
                          <tr key={i} className="hover:bg-white/5 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${peer.online ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className={peer.online ? 'text-slate-200' : 'text-slate-600'}>{peer.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${peer.role === 'master' ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                                {peer.role?.toUpperCase() || 'DISCONNECTED'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-400">{peer.mode || '-'}</td>
                            <td className="px-4 py-3 text-right">
                                {peer.online && (
                                  <button 
                                    onClick={() => alert("Fonctionnalité de contrôle à distance (Update Peer Mode) bientôt disponible !")}
                                    className="p-1 hover:bg-white/10 rounded-lg"
                                  >
                                    <Settings className="w-3 h-3 text-slate-400" />
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Gestion des Pairs */}
              <section className="space-y-4">
                <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Serveurs Pairs (Cluster Nodes)</label>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Adresse IP (ex: 192.168.1.50)"
                      value={newPeer.address}
                      onChange={(e) => setNewPeer({...newPeer, address: e.target.value})}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2 text-sm outline-none focus:border-purple-500"
                    />
                    <input 
                      type="number" 
                      placeholder="Port"
                      value={newPeer.port}
                      onChange={(e) => setNewPeer({...newPeer, port: e.target.value})}
                      className="w-20 bg-white/5 border border-white/10 rounded-xl p-2 text-sm outline-none focus:border-purple-500"
                    />
                    <button 
                      onClick={() => {
                        if (newPeer.address) {
                          setSettings({
                            ...settings, 
                            clusterNodes: [...settings.clusterNodes, { ...newPeer, port: parseInt(newPeer.port) }]
                          });
                          setNewPeer({ address: '', port: '8080' });
                        }
                      }}
                      className="px-4 bg-purple-600 hover:bg-purple-500 rounded-xl text-xs font-bold transition-colors"
                    >
                      Ajouter
                    </button>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                    {settings.clusterNodes.length > 0 ? settings.clusterNodes.map((peer, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                          <p className="text-sm font-mono text-slate-300">{peer.address}:{peer.port}</p>
                        </div>
                        <button 
                          onClick={() => {
                            const newNodes = [...settings.clusterNodes];
                            newNodes.splice(i, 1);
                            setSettings({...settings, clusterNodes: newNodes});
                          }}
                          className="p-1 hover:bg-white/10 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )) : (
                      <p className="text-center py-4 text-xs text-slate-600 italic">Aucun serveur pair configuré</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Actions de contrôle */}
              <section className="space-y-4">
                <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Contrôle du Cluster</label>
                <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-white">Prendre le contrôle (Master)</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Force ce serveur à devenir le Maître. Les autres serveurs passeront en mode Esclave.
                      </p>
                    </div>
                    <button 
                      onClick={async () => {
                        await window.gps.takeoverCluster();
                        alert("Ce serveur est désormais le MAÎTRE du cluster.");
                      }}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95"
                    >
                      TAKEOVER
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ONGLET DIAGNOSTIC */}
          {activeTab === 'diag' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold mb-1">Outils de Diagnostic</h3>
                  <p className="text-slate-400 text-xs">Testez la visibilité mDNS et les drivers sans interférence.</p>
                </div>

                {/* Mode Manuel directement accessible ici */}
                <div className="flex items-center justify-between p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <p className="text-xs font-bold text-white">Mode Maintenance (Manuel)</p>
                    </div>
                    <p className="text-[10px] text-amber-200/60 leading-relaxed">
                      Débraye l'automate pour tester les drivers individuellement.
                    </p>
                  </div>
                  <div 
                    onClick={handleManualModeToggle}
                    className={`w-10 h-5 rounded-full p-1 cursor-pointer transition-colors ${settings.manualTunnelMode ? 'bg-amber-600' : 'bg-slate-700'}`}
                  >
                    <motion.div 
                      animate={{ x: settings.manualTunnelMode ? 20 : 0 }}
                      className="w-3 h-3 bg-white rounded-full shadow-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <button 
                    disabled={isDiagRunning}
                    onClick={() => runDiagnostic('avahi')}
                    className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group disabled:opacity-50"
                  >
                    <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400 group-hover:scale-110 transition-transform">
                      <Globe className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-center">Scan Bonjour (Avahi)</span>
                  </button>

                  <button 
                    disabled={isDiagRunning}
                    onClick={() => runDiagnostic('pmd3')}
                    className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group disabled:opacity-50"
                  >
                    <div className="p-3 bg-emerald-500/20 rounded-xl text-emerald-400 group-hover:scale-110 transition-transform">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-center">PMD3 Driver Check</span>
                  </button>

                  <button 
                    disabled={isDiagRunning}
                    onClick={() => runDiagnostic('go-ios')}
                    className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group disabled:opacity-50"
                  >
                    <div className="p-3 bg-rose-500/20 rounded-xl text-rose-400 group-hover:scale-110 transition-transform">
                      <Terminal className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-center">GO-IOS List</span>
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute top-4 left-4 flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-slate-500" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Console de sortie</span>
                  </div>
                  <button 
                    onClick={() => setDiagLogs('')}
                    className="absolute top-4 right-4 text-[10px] font-bold text-slate-500 hover:text-white uppercase"
                  >
                    Effacer
                  </button>
                  <pre className="w-full h-80 bg-black/40 border border-white/10 rounded-2xl p-10 pt-12 font-mono text-[11px] text-emerald-500 overflow-y-auto custom-scrollbar">
                    {diagLogs || "Prêt pour le diagnostic..."}
                    {isDiagRunning && <span className="animate-pulse">_</span>}
                  </pre>
                </div>


                <div className="pt-4 border-t border-white/5 space-y-4">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Actions de Maintenance</h4>
                  <div className="flex gap-3">
                    <button 
                      onClick={stopAllTunnels}
                      className="flex-1 px-4 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-[10px] font-bold hover:bg-rose-500 hover:text-white transition-all uppercase tracking-tight"
                    >
                      Libérer Tunnels & Ports
                    </button>
                    <button 
                      onClick={() => toggleDriver('pmd3')}
                      className={`flex-1 px-4 py-2 border rounded-xl text-[10px] font-bold transition-all uppercase tracking-tight ${manualDrivers.pmd3 ? 'bg-emerald-500 border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'}`}
                    >
                      {manualDrivers.pmd3 ? 'PMD3 : ACTIF' : 'PMD3 : OFF'}
                    </button>
                    <button 
                      onClick={() => toggleDriver('goios')}
                      className={`flex-1 px-4 py-2 border rounded-xl text-[10px] font-bold transition-all uppercase tracking-tight ${manualDrivers.goios ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20'}`}
                    >
                      {manualDrivers.goios ? 'GO-IOS : ACTIF' : 'GO-IOS : OFF'}
                    </button>
                  </div>
                </div>
              </div>
          )}
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
