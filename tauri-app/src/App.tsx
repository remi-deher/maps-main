import { WebSocketProvider } from "./context/websocket";
import { InteractiveMap } from "./components/MapContainer";
import { LogBanner } from "./components/LogBanner";
import "./App.css";

function App() {
  return (
    <WebSocketProvider>
      <div className="app-container">
        {/* Fullscreen interactive Leaflet map — the entire app UI is floating overlays on it */}
        <InteractiveMap />

        {/* Engine LOG/LOGS warn/error events, surfaced app-wide */}
        <LogBanner />
      </div>
    </WebSocketProvider>
  );
}

export default App;
