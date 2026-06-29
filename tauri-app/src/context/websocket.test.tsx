import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { WebSocketProvider, useWebSocket } from "./websocket";
import { LogsProvider } from "./logsContext";
import { PairingProvider } from "./pairingContext";

const TestConsumer: React.FC = () => {
  const ws = useWebSocket();
  return (
    <div>
      <span data-testid="status">{ws.status?.state || "none"}</span>
      <span data-testid="connection">{ws.connectionStatus}</span>
      <button data-testid="set-location" onClick={() => ws.setLocation(40.7128, -74.0060, "NYC")}>
        Set NYC
      </button>
      <button data-testid="play-route" onClick={() => ws.playRoute(45.0, -75.0, 30, "driving")}>
        Play Route
      </button>
    </div>
  );
};

const PairingConsumer: React.FC = () => {
  const ws = useWebSocket();
  return (
    <div>
      <span data-testid="connection">{ws.connectionStatus}</span>
      <span data-testid="needs-pairing">{ws.needsPairing ? "yes" : "no"}</span>
      <button data-testid="submit-code" onClick={() => void ws.submitCode("123456")}>
        Pair
      </button>
    </div>
  );
};

describe("WebSocketContext Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provides default state and connects to mock websocket", async () => {
    await act(async () => {
      render(
        <LogsProvider>
          <PairingProvider>
            <WebSocketProvider>
              <TestConsumer />
            </WebSocketProvider>
          </PairingProvider>
        </LogsProvider>
      );
    });

    // Wait until connection state is connected
    await waitFor(() => {
      expect(screen.getByTestId("connection").textContent).toBe("connected");
    });

    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("correctly sends location and route payloads to mock websocket", async () => {
    // Spy on WebSocket send before rendering
    const sendSpy = vi.spyOn((globalThis as any).WebSocket.prototype, "send");

    await act(async () => {
      render(
        <LogsProvider>
          <PairingProvider>
            <WebSocketProvider>
              <TestConsumer />
            </WebSocketProvider>
          </PairingProvider>
        </LogsProvider>
      );
    });

    // Wait until connection state is connected
    await waitFor(() => {
      expect(screen.getByTestId("connection").textContent).toBe("connected");
    });

    const setLocBtn = screen.getByTestId("set-location");
    await act(async () => {
      setLocBtn.click();
    });

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: "SET_LOCATION",
        data: { lat: 40.7128, lon: -74.006, name: "NYC" },
      })
    );

    const playRouteBtn = screen.getByTestId("play-route");
    await act(async () => {
      playRouteBtn.click();
    });

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: "PLAY_ROUTE",
        data: { endLat: 45, endLon: -75, speed: 30, profile: "driving" },
      })
    );
  });
});

describe("WebSocketContext — remote pairing (browser mode)", () => {
  const TOKEN_KEY = "gpsmock.deviceToken";
  const seededToken = window.localStorage.getItem(TOKEN_KEY);

  beforeEach(() => {
    // Start each test as an *un*paired remote client.
    window.localStorage.removeItem(TOKEN_KEY);
  });

  afterEach(() => {
    // Restore the suite-wide seed so the other test files' assumptions hold.
    if (seededToken) window.localStorage.setItem(TOKEN_KEY, seededToken);
    vi.unstubAllGlobals();
  });

  it("requires pairing when no token is stored and does not connect", async () => {
    await act(async () => {
      render(
        <LogsProvider>
          <PairingProvider>
            <WebSocketProvider>
              <PairingConsumer />
            </WebSocketProvider>
          </PairingProvider>
        </LogsProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("needs-pairing").textContent).toBe("yes");
    });
    // Without a token the provider must not open the socket.
    expect(screen.getByTestId("connection").textContent).not.toBe("connected");
  });

  it("redeems a code, stores the token, and connects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "newdevice.secret-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      render(
        <LogsProvider>
          <PairingProvider>
            <WebSocketProvider>
              <PairingConsumer />
            </WebSocketProvider>
          </PairingProvider>
        </LogsProvider>
      );
    });

    await act(async () => {
      screen.getByTestId("submit-code").click();
    });

    // Token persisted and the socket comes up.
    await waitFor(() => {
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe("newdevice.secret-token");
    });
    await waitFor(() => {
      expect(screen.getByTestId("connection").textContent).toBe("connected");
    });

    // The code was POSTed to the engine's pairing endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/pair"),
      expect.objectContaining({ method: "POST" })
    );
  });
});
