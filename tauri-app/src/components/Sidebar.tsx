import React, { useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  MapPinned,
  Route,
  ScrollText,
  Settings,
  Smartphone,
  Star,
} from "lucide-react";
import { useWebSocket } from "../context/websocket";
import { ControlTab } from "./tabs/ControlTab";
import { FavoritesTab } from "./tabs/FavoritesTab";
import { LogsTab } from "./tabs/LogsTab";
import { SequencesTab } from "./tabs/SequencesTab";
import { SettingsTab } from "./tabs/SettingsTab";

type ShellTab = "control" | "route" | "favs" | "logs" | "settings";

const NAV_ITEMS: Array<{
  id: ShellTab;
  label: string;
  title: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "control", label: "Pilotage", title: "Pilotage", icon: Activity },
  { id: "route", label: "Trajets", title: "Trajets", icon: Route },
  { id: "favs", label: "Favoris", title: "Favoris", icon: Star },
  { id: "logs", label: "Logs", title: "Journaux", icon: ScrollText },
  { id: "settings", label: "Réglages", title: "Réglages", icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { isConnected, status } = useWebSocket();

  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<ShellTab>("control");
  const [toast, setToast] = useState<string | null>(null);

  const activeItem = useMemo(() => NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0], [activeTab]);
  const currentDriver = status?.deviceInfo?.driver || status?.usbDriver || "driver";
  const currentState = isConnected ? status?.state || "connecté" : "hors ligne";

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case "control":
        return <ControlTab showToast={showToast} />;
      case "route":
        return <SequencesTab showToast={showToast} />;
      case "favs":
        return <FavoritesTab showToast={showToast} />;
      case "logs":
        return <LogsTab />;
      case "settings":
        return <SettingsTab showToast={showToast} />;
    }
  };

  return (
    <>
      <aside className={`app-shell ${isPanelOpen ? "" : "panel-collapsed"}`} aria-label="GPS-Mock navigation">
        <nav className="app-rail" aria-label="Navigation principale">
          <div className="rail-brand" title="GPS-Mock v3">
            <Smartphone size={22} />
          </div>

          <div className="rail-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`rail-nav-btn ${activeTab === item.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsPanelOpen(true);
                  }}
                  title={item.title}
                  aria-label={item.title}
                  aria-current={activeTab === item.id ? "page" : undefined}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <button
            className="rail-collapse-btn"
            type="button"
            onClick={() => setIsPanelOpen((open) => !open)}
            title={isPanelOpen ? "Masquer le panneau" : "Afficher le panneau"}
            aria-label={isPanelOpen ? "Masquer le panneau" : "Afficher le panneau"}
          >
            {isPanelOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </nav>

        <section className="work-panel" aria-label={activeItem.title}>
          <header className="work-panel-header">
            <div className="work-title-block">
              <span className="work-kicker">
                <MapPinned size={14} />
                GPS-Mock v3
              </span>
              <h1>{activeItem.title}</h1>
            </div>
            <div className={`status-badge ${isConnected ? "connected" : "disconnected"}`}>
              <span className="pulse-dot"></span>
              {currentState}
            </div>
          </header>

          <div className="shell-status-strip">
            <div>
              <span>Moteur</span>
              <strong>{isConnected ? "en ligne" : "offline"}</strong>
            </div>
            <div>
              <span>Tunnel</span>
              <strong>{status?.tunnelActive ? "actif" : "inactif"}</strong>
            </div>
            <div>
              <span>Driver</span>
              <strong>{currentDriver}</strong>
            </div>
          </div>

          <div className="work-panel-content">{renderActiveTab()}</div>
        </section>
      </aside>

      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  );
};
