// Service de logs simple pour le diagnostic mobile
export const logEvent = {
  history: [],
  listeners: [],
  
  add(message, type = 'info') {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type // 'info', 'error', 'success'
    };
    this.history = [entry, ...this.history].slice(0, 50);
    this.listeners.forEach(cb => cb(this.history));
    console.log(`[LOG] ${entry.timestamp} - ${message}`);
  },

  subscribe(cb) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }
};
