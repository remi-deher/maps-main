import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { LogEntry } from "../types/engine";
import { engineEvents } from "../lib/events";

export interface LogsContextValue {
  logs: LogEntry[];
  appendLog: (log: LogEntry) => void;
  setLogs: (logs: LogEntry[]) => void;
  clearLogs: () => void;
}

const LogsContext = createContext<LogsContextValue | null>(null);

export const LogsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogsState] = useState<LogEntry[]>([]);
  const MAX_LOGS = 200;

  const appendLog = useCallback((log: LogEntry) => {
    setLogsState((prev) => {
      const next = [...prev, log];
      if (next.length > MAX_LOGS) return next.slice(next.length - MAX_LOGS);
      return next;
    });
  }, []);

  // A GET_LOGS snapshot is *merged* into the existing buffer rather than
  // replacing it: on a reconnect after the engine restarted, the server's
  // buffer may be empty or short, and a plain replace would wipe the history
  // the operator needs to diagnose the very outage they just hit. Dedup by
  // (timestamp,message), keep chronological order, cap at MAX_LOGS.
  const setLogs = useCallback((incoming: LogEntry[]) => {
    setLogsState((prev) => {
      if (prev.length === 0) {
        return incoming.length > MAX_LOGS ? incoming.slice(incoming.length - MAX_LOGS) : incoming;
      }
      const keyOf = (e: LogEntry) => `${e.timestamp}|${e.message}`;
      const seen = new Set(prev.map(keyOf));
      const merged = prev.slice();
      for (const entry of incoming) {
        const k = keyOf(entry);
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(entry);
        }
      }
      merged.sort((a, b) => a.timestamp - b.timestamp);
      return merged.length > MAX_LOGS ? merged.slice(merged.length - MAX_LOGS) : merged;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogsState([]);
  }, []);

  useEffect(() => {
    const handleLog = (log: LogEntry) => appendLog(log);
    const handleLogs = (logsList: LogEntry[]) => setLogs(logsList);
    
    engineEvents.on("log", handleLog);
    engineEvents.on("logs", handleLogs);
    return () => {
      engineEvents.off("log", handleLog);
      engineEvents.off("logs", handleLogs);
    };
  }, [appendLog, setLogs]);

  return (
    <LogsContext.Provider value={{ logs, appendLog, setLogs, clearLogs }}>
      {children}
    </LogsContext.Provider>
  );
};

export const useLogs = () => {
  const ctx = useContext(LogsContext);
  if (!ctx) throw new Error("useLogs must be used within LogsProvider");
  return ctx;
};
