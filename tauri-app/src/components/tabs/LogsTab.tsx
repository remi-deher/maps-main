import React, { useMemo, useState } from "react";
import { Clipboard, ListFilter, RotateCw, ScrollText, X } from "lucide-react";
import { useEngine } from "../../context/websocket";
import type { LogEntry } from "../../types/engine";
import { useLogs } from "../../context/logsContext";
import { EngineAction } from "../../types/engineMessages";

type LevelFilter = "all" | "info" | "warn" | "error";

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const [level, setLevel] = useState<LevelFilter>("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [action, setAction] = useState("all");
  const [query, setQuery] = useState("");

  const sources = useMemo(() => uniqueValues(logs, "source"), [logs]);
  const categories = useMemo(() => uniqueValues(logs, "category"), [logs]);
  const actions = useMemo(() => uniqueValues(logs, "action"), [logs]);

  const filteredLogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs
      .filter((entry) => level === "all" || entry.level === level)
      .filter((entry) => source === "all" || entry.source === source)
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => action === "all" || entry.action === action)
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
  }, [action, category, level, logs, query, source]);

  const resetFilters = () => {
    setLevel("all");
    setSource("all");
    setCategory("all");
    setAction("all");
    setQuery("");
  };

  const copyFilteredLogs = async () => {
    const text = filteredLogs.map((entry) => {
      const meta = [entry.level, entry.source, entry.category, entry.action].filter(Boolean).join(" ");
      return `${formatTime(entry.timestamp)} ${meta} ${entry.message} ${fieldsText(entry)}`.trim();
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
          <button className="icon-btn" type="button" onClick={copyFilteredLogs} disabled={filteredLogs.length === 0} title="Copier">
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
          <span className="form-label">Niveau</span>
          <select value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)}>
            <option value="all">Tous</option>
            <option value="info">Info</option>
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
        <label className="form-group">
          <span className="form-label">Action</span>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="all">Toutes</option>
            {actions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <label className="logs-search">
        <ListFilter size={15} />
        <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrer" />
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
                <span className="log-time">{formatTime(entry.timestamp)}</span>
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
