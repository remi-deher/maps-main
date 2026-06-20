// Service de logs simple pour le diagnostic mobile

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

type LogListener = (history: LogEntry[]) => void;

export const logEvent = {
  history: [] as LogEntry[],
  listeners: [] as LogListener[],
  
  add(message: string, type: 'info' | 'error' | 'success' = 'info') {
    const entry: LogEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    this.history = [entry, ...this.history].slice(0, 50);
    this.listeners.forEach(cb => cb(this.history));
    console.log(`[LOG] ${entry.timestamp} - ${message}`);
  },

  subscribe(cb: LogListener) {
    this.listeners.push(cb);
    return () => { 
      this.listeners = this.listeners.filter(l => l !== cb); 
    };
  }
};
