import React, { useMemo, useState } from "react";
import { Clipboard, ListFilter, RotateCw, ScrollText, X } from "lucide-react";
import { useEngine } from "../../context/websocket";
import type { LogEntry } from "../../types/engine";
import { useLogs } from "../../context/logsContext";
import { EngineAction } from "../../types/engineMessages";

type LogMode = "normal" | "ultraDetailed";
type LevelFilter = "all" | "info" | "debugConsole" | "warn" | "error";

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const formatTimeMs = (timestamp: number) => {
  const d = new Date(timestamp);
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${timeStr}.${ms}`;
};

const uniqueValues = (logs: LogEntry[], key: "source" | "category" | "action") => {
  return Array.from(new Set(logs.map((entry) => entry[key]).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
};

const fieldsText = (entry: LogEntry) => {
  if (!entry.fields) return "";
  return Object.entries(entry.fields).map(([key, value]) => `${key}=${value}`).join(" ");
};

export const LogsTab: React.FC = () => {
  const { sendMessage, canSend } = useEngine();
  const { logs } = useLogs();
  const [logMode, setLogMode] = useState<LogMode>("normal");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const sources = useMemo(() => uniqueValues(logs, "source"), [logs]);
  const categories = useMemo(() => uniqueValues(logs, "category"), [logs]);

  const filteredLogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs
      .filter((entry) => {
        // Normal mode hides debug & console by default unless explicitly filtered
        if (logMode === "normal" && level === "all") {
          if (entry.level === "debug" || entry.level === "console") return false;
        }
        if (level === "info") return entry.level === "info";
        if (level === "debugConsole") return entry.level === "debug" || entry.level === "console";
        if (level === "warn") return entry.level === "warn";
        if (level === "error") return entry.level === "error";
        return true;
      })
      .filter((entry) => source === "all" || entry.source === source)
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => {
        if (!needle) return true;
        return [
          entry.level,
          entry.source,
          entry.category ?? "",
          entry.action ?? "",
          entry.message,
          fieldsText(entry),
        ].some((value) => value.toLowerCase().includes(needle));
      })
      .slice()
      .reverse();
  }, [category, level, logMode, logs, query, source]);

  const resetFilters = () => {
    setLevel("all");
    setSource("all");
    setCategory("all");
    setQuery("");
  };

  const copyFilteredLogs = async () => {
    const text = filteredLogs.map((entry) => {
      const time = logMode === "ultraDetailed" ? formatTimeMs(entry.timestamp) : formatTime(entry.timestamp);
      const meta = [entry.level.toUpperCase(), entry.source, entry.category, entry.action].filter(Boolean).join(" ");
      return `[${time}] ${meta} - ${entry.message} ${fieldsText(entry)}`.trim();
    }).join("\n");
    await navigator.clipboard?.writeText(text);
  };

  return (
    <div className="logs-panel">
      <div className="logs-toolbar">
        <div className="logs-title">
          <ScrollText size={16} />
          <span>Journaux</span>
          <b>{filteredLogs.length}</b>
        </div>
        <div className="logs-actions">
          <button className="icon-btn" type="button" onClick={copyFilteredLogs} disabled={filteredLogs.length === 0} title="Copier les journaux">
            <Clipboard size={16} />
          </button>
          <button className="icon-btn" type="button" onClick={resetFilters} title="Réinitialiser les filtres">
            <X size={16} />
          </button>
          <button className="icon-btn" type="button" onClick={() => sendMessage(EngineAction.GetLogs)} disabled={!canSend} title="Rafraîchir">
            <RotateCw size={16} />
          </button>
        </div>
      </div>

      <div className="logs-filter-grid">
        <label className="form-group">
          <span className="form-label">Mode d'affichage</span>
          <select value={logMode} onChange={(event) => setLogMode(event.target.value as LogMode)}>
            <option value="normal">Normal</option>
            <option value="ultraDetailed">Ultra-détaillé</option>
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Niveau</span>
          <select value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)}>
            <option value="all">Tous</option>
            <option value="info">Info</option>
            <option value="debugConsole">Debug & Console</option>
            <option value="warn">Avert.</option>
            <option value="error">Erreurs</option>
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Source</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">Toutes</option>
            {sources.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Catégorie</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Toutes</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <label className="logs-search">
        <ListFilter size={15} />
        <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrer dans les journaux" />
      </label>

      <div className="logs-list">
        {filteredLogs.length === 0 ? (
          <div className="empty-state">
            <ScrollText size={22} className="empty-state-icon" />
            <span>Aucun journal pour le moment.</span>
            <span className="empty-state-hint">Les événements du moteur GPS-Mock apparaîtront ici.</span>
          </div>
        ) : (
          filteredLogs.map((entry, index) => (
            <article className={`log-row level-${entry.level}`} key={`${entry.timestamp}-${index}`}>
              <div className="log-row-main">
                <span className="log-time">
                  {logMode === "ultraDetailed" ? formatTimeMs(entry.timestamp) : formatTime(entry.timestamp)}
                </span>
                <span className="log-message">{entry.message}</span>
              </div>
              <div className="log-meta">
                <span className={`log-pill level-${entry.level}`}>{entry.level}</span>
                <span>{entry.source}</span>
                {entry.category && <span>{entry.category}</span>}
                {entry.action && <span>{entry.action}</span>}
              </div>
              {entry.fields && Object.keys(entry.fields).length > 0 && (
                <div className="log-fields">{fieldsText(entry)}</div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
};
