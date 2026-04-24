import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Smartphone, Globe, Hash } from 'lucide-react';

function QrModal({ isOpen, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [connInfo, setConnInfo] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [preferredIp, setPreferredIp] = useState('');

  const refreshQr = async () => {
    const res = await window.gps.getCompanionQr();
    if (res.success) {
      setQrData(res.dataUrl);
      setConnInfo({ ip: res.ip, port: res.port });
    }
  };

  useEffect(() => {
    if (isOpen) {
      window.gps.getNetworkInterfaces().then(setInterfaces);
      window.gps.getSettings().then(s => setPreferredIp(s.preferredIp || ''));
      refreshQr();
    }
  }, [isOpen]);

  const handleInterfaceChange = async (ip) => {
    setPreferredIp(ip);
    await window.gps.saveSettings({ preferredIp: ip });
    // Attendre un tout petit peu que le backend prenne en compte le changement
    setTimeout(refreshQr, 100);
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
        className="relative w-full max-w-sm glass-dark rounded-3xl shadow-2xl overflow-hidden border border-white/10 p-8 text-center"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-xl transition-colors">
          <X className="w-6 h-6" />
        </button>

        <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-blue-400">
          <Smartphone className="w-8 h-8" />
        </div>

        <h2 className="text-xl font-bold mb-2">Connecter l'iPhone</h2>
        <p className="text-slate-400 text-sm mb-6">Scannez ce QR Code pour configurer automatiquement la connexion.</p>

        <div className="bg-white p-4 rounded-3xl inline-block shadow-2xl mb-6">
          {qrData ? (
            <img src={qrData} alt="QR Code" className="w-40 h-40" />
          ) : (
            <div className="w-40 h-40 flex items-center justify-center text-slate-900 font-bold italic">
              Génération...
            </div>
          )}
        </div>

        {/* Sélecteur d'interface rapide */}
        <div className="mb-6 space-y-2 text-left">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Choix de l'interface réseau</label>
          <select 
            value={preferredIp}
            onChange={(e) => handleInterfaceChange(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors text-white text-xs appearance-none cursor-pointer"
          >
            <option value="" className="bg-slate-900">Auto-détection</option>
            {interfaces.map((iface, i) => (
              <option key={i} value={iface.address} className="bg-slate-900">
                {iface.name} ({iface.address})
              </option>
            ))}
          </select>
        </div>

        {/* Bloc de vérification IP / Port */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-left">
            <div className="flex items-center gap-2 text-blue-400 mb-1">
              <Globe className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">IP Utilisée</span>
            </div>
            <p className="text-xs font-mono text-white truncate">{connInfo?.ip || '...'}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-left">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <Hash className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Port</span>
            </div>
            <p className="text-xs font-mono text-white">{connInfo?.port || '....'}</p>
          </div>
        </div>

        <p className="mt-6 text-[10px] text-slate-500 italic">
          Assurez-vous que l'iPhone est sur le même réseau Wi-Fi.
        </p>
      </motion.div>
    </div>
  );
}

export default QrModal;
