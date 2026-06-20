import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, vi } from "vitest";

expect.extend(matchers);



// Mock WebSocket globally
class MockWebSocket {
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
