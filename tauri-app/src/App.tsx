import { WebSocketProvider } from "./context/websocket";
import { InteractiveMap } from "./components/MapContainer";
import { Sidebar } from "./components/Sidebar";
import "./App.css";

function App() {
  return (
    <WebSocketProvider>
      <div className="app-container">
        {/* Fullscreen Interactive Leaflet Map */}
        <InteractiveMap />

        {/* Floating Glassmorphic Sidebar panel */}
        <Sidebar />
      </div>
    </WebSocketProvider>
  );
}

export default App;
