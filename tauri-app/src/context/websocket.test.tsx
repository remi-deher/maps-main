import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { WebSocketProvider, useWebSocket } from "./websocket";

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

describe("WebSocketContext Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provides default state and connects to mock websocket", async () => {
    await act(async () => {
      render(
        <WebSocketProvider>
          <TestConsumer />
        </WebSocketProvider>
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
        <WebSocketProvider>
          <TestConsumer />
        </WebSocketProvider>
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
