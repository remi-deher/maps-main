import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, vi } from "vitest";

expect.extend(matchers);

// Tests run in jsdom, i.e. browser mode (not Tauri). Browser mode now requires a
// durable device token before it will open the WebSocket; seed one so the suite
// exercises the steady-state "already paired" client rather than the pairing
// gate. Individual tests can clear it to assert the gate instead.
try {
  window.localStorage.setItem("gpsmock.deviceToken", "test-device.test-secret");
} catch {
  /* no localStorage in this environment */
}



// Mock WebSocket globally
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data: string) {
    // Mock incoming message echo or status mock back
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "GET_STATUS" && this.onmessage) {
        this.onmessage({
          data: JSON.stringify({
            type: "STATUS",
            data: {
              state: "idle",
              tunnelActive: false,
              rsdAddress: null,
              rsdPort: null,
              connectionType: "UNKNOWN",
              deviceInfo: null,
              maintainActive: false,
              lastHeartbeat: null,
              usbDriver: "go-ios",
              wifiDriver: "pymobiledevice",
              fallbackEnabled: false,
              notificationsEnabled: true,
              dynamicIslandEnabled: false,
              favorites: [
                { lat: 48.8566, lon: 2.3522, name: "Paris, FR" }
              ],
              recentHistory: [],
              currentSequencePreview: [],
              patrolZone: null,
              navigation: { progress: null, status: null }
            }
          })
        });
      }
    } catch (e) {}
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}

global.WebSocket = MockWebSocket as any;

// Mock the Tauri JS bridge: tests run in jsdom, not inside a real Tauri webview.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock Leaflet
vi.mock("react-leaflet", () => {
  return {
    MapContainer: ({ children }: any) => `<div data-testid="map-container">${children}</div>`,
    TileLayer: () => `<div data-testid="tile-layer"></div>`,
    Marker: ({ children }: any) => `<div data-testid="marker">${children}</div>`,
    Popup: ({ children }: any) => `<div data-testid="popup">${children}</div>`,
    Polyline: () => `<div data-testid="polyline"></div>`,
    useMap: () => ({
      panTo: vi.fn(),
    }),
    useMapEvents: () => vi.fn(),
  };
});

vi.mock("leaflet", () => {
  return {
    default: {
      divIcon: vi.fn(() => ({})),
      Icon: {
        Default: {
          prototype: {},
          mergeOptions: vi.fn(),
        }
      }
    }
  };
});
