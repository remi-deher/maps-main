import { WebSocketProvider } from "./context/websocket";
import { LogsProvider } from "./context/logsContext";
import { PairingProvider } from "./context/pairingContext";
import { InteractiveMap } from "./components/MapContainer";
import { LogBanner } from "./components/LogBanner";
import { PairingGate } from "./components/PairingGate";
import "./App.css";

function App() {
  return (
    <LogsProvider>
      <PairingProvider>
        <WebSocketProvider>
          <div className="app-container">
            {/* Fullscreen interactive Leaflet map — the entire app UI is floating overlays on it */}
            <InteractiveMap />

            {/* Engine LOG/LOGS warn/error events, surfaced app-wide */}
            <LogBanner />

            {/* Remote-access pairing prompt (browser mode only; no-op under Tauri) */}
            <PairingGate />
          </div>
        </WebSocketProvider>
      </PairingProvider>
    </LogsProvider>
  );
}

export default App;
