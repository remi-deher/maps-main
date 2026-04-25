import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Terminal, Smartphone, Monitor, Trash2, Download, Copy, Check } from 'lucide-react';

function LogsModal({ isOpen, onClose, serverLogs, clientLogs, onClearServer, onClearClient }) {
  const [activeTab, setActiveTab] = useState('server'); // 'server' or 'client'
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef(null);

  const logs = activeTab === 'server' ? serverLogs : clientLogs;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, activeTab, isOpen]);

  const handleCopy = () => {
    const text = logs.map(l => `[${l.timestamp}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 30 }}
        className="relative w-full max-w-5xl h-[85vh] glass-deeper rounded-3xl shadow-2xl overflow-hidden border border-white/10 flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-4">
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              <button 
                onClick={() => setActiveTab('server')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${activeTab === 'server' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                <Monitor className="w-4 h-4" />
                <span className="text-sm font-bold">Console Serveur (PC)</span>
              </button>
              <button 
                onClick={() => setActiveTab('client')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${activeTab === 'client' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                <Smartphone className="w-4 h-4" />
                <span className="text-sm font-bold">Console iPhone</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={handleCopy}
              title="Copier les logs"
              className="p-2.5 hover:bg-white/10 rounded-xl transition-colors text-slate-400"
            >
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </button>
            <button 
              onClick={activeTab === 'server' ? onClearServer : onClearClient}
              title="Effacer les logs"
              className="p-2.5 hover:bg-rose-500/10 rounded-xl transition-colors text-rose-400"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-white/10 mx-2" />
            <button onClick={onClose} className="p-2.5 hover:bg-white/10 rounded-xl transition-colors text-slate-300">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed custom-scrollbar bg-black/20"
        >
          {logs.length > 0 ? (
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-4 group">
                  <span className="text-slate-600 select-none min-w-[85px]">{log.timestamp}</span>
                  <span className={`flex-1 break-all ${
                    log.message.includes('[ERR]') || log.message.includes('❌') || log.type === 'error' ? 'text-rose-400' :
                    log.message.includes('[OK]') || log.message.includes('✅') || log.type === 'success' ? 'text-emerald-400' :
                    log.message.includes('[SRV]') ? 'text-blue-400' :
                    log.message.includes('[IN]') ? 'text-amber-400' :
                    log.message.includes('[OUT]') ? 'text-indigo-400' :
                    log.message.includes('[CMD]') ? 'text-cyan-400' :
                    log.message.includes('[gps-bridge]') ? 'text-slate-500 italic' :
                    'text-slate-300'
                  }`}>
                    {log.message}
                  </span>
                </div>
              ))}
              <div className="h-4" /> {/* Spacer for bottom */}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
              <Terminal className="w-12 h-12 opacity-20" />
              <p className="italic">Aucun log enregistré pour cette session.</p>
            </div>
          )}
        </div>

        {/* Footer / Status Bar */}
        <div className="px-6 py-3 bg-black/40 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500 font-bold tracking-widest uppercase">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${activeTab === 'server' ? 'bg-blue-500' : 'bg-emerald-500'} animate-pulse`} />
              {activeTab === 'server' ? 'Serveur Actif' : 'Client iPhone Connecté'}
            </div>
            <span>{logs.length} entrées au total</span>
          </div>
          <div>Pressez ESC pour fermer</div>
        </div>
      </motion.div>
    </div>
  );
}

export default LogsModal;
