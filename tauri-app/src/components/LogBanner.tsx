import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, AlertCircle, X } from "lucide-react";
import { useWebSocket, LogEntry } from "../context/websocket";

interface Banner extends LogEntry {
  id: number;
}

const AUTO_DISMISS_MS = 8000;

// Surfaces engine LOG/LOGS warn/error events as dismissible banners, visible
// app-wide regardless of which modal/panel is open — previously these events
// only reached the browser console (C2, server UX audit).
export const LogBanner: React.FC = () => {
  const { logs } = useWebSocket();
  const [banners, setBanners] = useState<Banner[]>([]);
  const seenCount = useRef(0);
  const nextId = useRef(0);

  useEffect(() => {
    if (logs.length <= seenCount.current) {
      // GET_LOGS snapshot replaced the buffer (e.g. on reconnect): don't
      // replay history as new banners, just resync the watermark.
      seenCount.current = logs.length;
      return;
    }
    const newEntries = logs.slice(seenCount.current).filter((e) => e.level !== "info");
    seenCount.current = logs.length;
    if (newEntries.length === 0) return;

    const added: Banner[] = newEntries.map((entry) => ({ ...entry, id: nextId.current++ }));
    setBanners((prev) => [...prev, ...added]);
    added.forEach((banner) => {
      window.setTimeout(() => {
        setBanners((prev) => prev.filter((b) => b.id !== banner.id));
      }, AUTO_DISMISS_MS);
    });
  }, [logs]);

  const dismiss = (id: number) => setBanners((prev) => prev.filter((b) => b.id !== id));

  if (banners.length === 0) return null;

  return (
    <div className="log-banner-stack" role="log" aria-live="polite">
      {banners.map((banner) => (
        <div key={banner.id} className={`log-banner log-banner-${banner.level}`}>
          {banner.level === "error" ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
          <span className="log-banner-message">{banner.message}</span>
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
