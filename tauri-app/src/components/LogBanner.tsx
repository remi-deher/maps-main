import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, AlertCircle, X } from "lucide-react";
import { LogEntry } from "../types/engine";
import { useLogs } from "../context/logsContext";

interface Banner extends LogEntry {
  id: number;
  count: number;
}

const AUTO_DISMISS_MS = 8000;
// Cap how many banners are stacked at once so an unstable tunnel (the exact
// long-run failure mode this guards against) can't bury the screen under a
// wall of warnings. Extra ones are summarised as "+N autres".
const MAX_VISIBLE = 3;

// Surfaces engine LOG/LOGS warn/error events as dismissible banners, visible
// app-wide regardless of which modal/panel is open — previously these events
// only reached the browser console (C2, server UX audit).
export const LogBanner: React.FC = () => {
  const { logs } = useLogs();
  const [banners, setBanners] = useState<Banner[]>([]);
  // Which log entries have already been considered, keyed by (timestamp,
  // message). A key-set (not a count watermark) so it stays correct when the
  // buffer is merged/reordered on reconnect (U7) rather than pure-appended.
  const seenKeys = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const nextId = useRef(0);
  // Per-banner dismiss timers, so a deduplicated banner can have its timer
  // refreshed instead of leaking the old one.
  const timers = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const keyOf = (e: LogEntry) => `${e.timestamp}|${e.message}`;

    // First run: seed the seen-set from whatever history is already present
    // (the initial GET_LOGS snapshot) without banners — those are past events,
    // not fresh alerts.
    if (!initialized.current) {
      initialized.current = true;
      for (const e of logs) seenKeys.current.add(keyOf(e));
      return;
    }

    const newEntries: LogEntry[] = [];
    for (const e of logs) {
      const k = keyOf(e);
      if (!seenKeys.current.has(k)) {
        seenKeys.current.add(k);
        if (e.level !== "info") newEntries.push(e);
      }
    }

    // Keep the seen-set from growing unbounded over a long session: entries
    // evicted from the (capped) buffer can never reappear, so prune to the
    // current buffer's keys once it drifts well past its size.
    if (seenKeys.current.size > logs.length * 2) {
      seenKeys.current = new Set(logs.map(keyOf));
    }

    if (newEntries.length === 0) return;

    setBanners((prev) => {
      const next = [...prev];
      for (const entry of newEntries) {
        const last = next[next.length - 1];
        if (last && last.message === entry.message && last.level === entry.level) {
          // Collapse a repeated identical message into a ×N counter and
          // refresh its lifetime rather than stacking duplicates.
          next[next.length - 1] = { ...last, count: last.count + 1 };
          scheduleDismiss(last.id);
        } else {
          const id = nextId.current++;
          next.push({ ...entry, id, count: 1 });
          scheduleDismiss(id);
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs]);

  const scheduleDismiss = (id: number) => {
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const handle = window.setTimeout(() => {
      timers.current.delete(id);
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, AUTO_DISMISS_MS);
    timers.current.set(id, handle);
  };

  // Clear any outstanding timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => window.clearTimeout(h));
      map.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const handle = timers.current.get(id);
    if (handle) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
    setBanners((prev) => prev.filter((b) => b.id !== id));
  };

  if (banners.length === 0) return null;

  // Show only the most recent MAX_VISIBLE; older ones are summarised.
  const visible = banners.slice(-MAX_VISIBLE);
  const hiddenCount = banners.length - visible.length;

  return (
    <div className="log-banner-stack" role="log" aria-live="polite">
      {hiddenCount > 0 && (
        <div className="log-banner log-banner-more">+{hiddenCount} autre{hiddenCount > 1 ? "s" : ""}</div>
      )}
      {visible.map((banner) => (
        <div key={banner.id} className={`log-banner log-banner-${banner.level}`}>
          {banner.level === "error" ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
          <span className="log-banner-message">
            {banner.message}
            {banner.count > 1 && <span className="log-banner-count"> ×{banner.count}</span>}
          </span>
          <button
            type="button"
            className="log-banner-dismiss"
            aria-label="Ignorer ce message"
            onClick={() => dismiss(banner.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
