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

  const setLogs = useCallback((newLogs: LogEntry[]) => {
    setLogsState(newLogs);
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
