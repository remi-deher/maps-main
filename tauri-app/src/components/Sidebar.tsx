import React, { useState } from "react";
import {
  Activity,
  Star,
  Settings,
  ChevronLeft,
  ChevronRight,
  Route,
  Smartphone,
  ScrollText,
} from "lucide-react";
import { useWebSocket } from "../context/websocket";
import { ControlTab } from "./tabs/ControlTab";
import { FavoritesTab } from "./tabs/FavoritesTab";
import { SequencesTab } from "./tabs/SequencesTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { LogsTab } from "./tabs/LogsTab";

type SidebarTab = "control" | "favs" | "route" | "logs" | "settings";

export const Sidebar: React.FC = () => {
  const { isConnected, status } = useWebSocket();

  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>("control");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      <button className="sidebar-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      <div className={`sidebar ${isOpen ? "" : "collapsed"}`}>
        <div className="sidebar-header">
          <div className="brand">
            <Smartphone size={22} className="text-indigo-400" />
            <h1>GPS-Mock v3</h1>
          </div>
          <div className={`status-badge ${isConnected ? "connected" : "disconnected"}`}>
            <span className="pulse-dot"></span>
            {isConnected ? (status?.state || "connecté") : "hors ligne"}
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="tabs-nav">
          <button
            className={`tab-btn ${activeTab === "control" ? "active" : ""}`}
            onClick={() => setActiveTab("control")}
          >
            <Activity size={18} />
            <span>Contrôle</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "favs" ? "active" : ""}`}
            onClick={() => setActiveTab("favs")}
          >
            <Star size={18} />
            <span>Favoris</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "route" ? "active" : ""}`}
            onClick={() => setActiveTab("route")}
          >
            <Route size={18} />
            <span>Séquences</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            <ScrollText size={18} />
            <span>Logs</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={18} />
            <span>Réglages</span>
          </button>
        </div>

        <div className="sidebar-content">
          {/* TAB 1: CONTROL & TELEMETRY */}
          {activeTab === "control" && <ControlTab showToast={showToast} />}

          {/* TAB 2: FAVORITES & HISTORY */}
          {activeTab === "favs" && <FavoritesTab showToast={showToast} />}

          {/* TAB 3: ROUTE & SEQUENCES BUILDER */}
          {activeTab === "route" && <SequencesTab showToast={showToast} />}

          {/* TAB 4: LOGS */}
          {activeTab === "logs" && <LogsTab />}

          {/* TAB 5: SETTINGS */}
          {activeTab === "settings" && <SettingsTab showToast={showToast} />}
        </div>
      </div>
      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  );
};
