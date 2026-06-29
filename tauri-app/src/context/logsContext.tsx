import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { LogEntryPayload } from "../types/engine";
import { engineEvents } from "../lib/events";

export interface LogsContextValue {
  logs: LogEntryPayload[];
  appendLog: (log: LogEntryPayload) => void;
  setLogs: (logs: LogEntryPayload[]) => void;
  clearLogs: () => void;
}

const LogsContext = createContext<LogsContextValue | null>(null);

export const LogsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogsState] = useState<LogEntryPayload[]>([]);
  const MAX_LOGS = 200;

  const appendLog = useCallback((log: LogEntryPayload) => {
    setLogsState((prev) => {
      const next = [...prev, log];
      if (next.length > MAX_LOGS) return next.slice(next.length - MAX_LOGS);
      return next;
    });
  }, []);

  const setLogs = useCallback((newLogs: LogEntryPayload[]) => {
    setLogsState(newLogs);
  }, []);

  const clearLogs = useCallback(() => {
    setLogsState([]);
  }, []);

  useEffect(() => {
    const handleLog = (log: LogEntryPayload) => appendLog(log);
    const handleLogs = (logsList: LogEntryPayload[]) => setLogs(logsList);
    
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
