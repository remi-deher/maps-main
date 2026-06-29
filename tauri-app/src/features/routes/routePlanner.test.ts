import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveRouteOptions, calculateHaversineTotal, calculateFallbackDurationSeconds } from "./routePlanner";
import * as osrm from "../../lib/osrm";
import * as transit from "../../lib/transit";
import type { Waypoint } from "./routeModel";
import type { LatLon } from "../../types/engine";

// Mock the external libraries
vi.mock("../../lib/osrm", async () => {
  const actual = await vi.importActual("../../lib/osrm");
  return {
    ...actual,
    fetchRoute: vi.fn(),
    fetchAlternatives: vi.fn(),
  };
});

vi.mock("../../lib/transit", () => ({
  isTransitEnabled: vi.fn(),
  planTransitJourney: vi.fn(),
}));

describe("routePlanner", () => {
  const START: LatLon = { lat: 48.8566, lon: 2.3522 }; // Paris
  const WAYPOINT_1: Waypoint = { id: "1", name: "P1", lat: 48.8584, lon: 2.345, mode: "drive" }; // Near Paris
  const WAYPOINT_2: Waypoint = { id: "2", name: "P2", lat: 48.8600, lon: 2.340, mode: "walk" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateHaversineTotal", () => {
    it("should calculate total distance via straight lines", () => {
      // Small distance between these points
      const dist = calculateHaversineTotal([WAYPOINT_1, WAYPOINT_2], START);
      expect(dist).toBeGreaterThan(0);
      expect(dist).toBeLessThan(5000); // Should be < 5km
    });
  });

  describe("calculateFallbackDurationSeconds", () => {
    it("should calculate duration based on default speeds", () => {
      const dur = calculateFallbackDurationSeconds([WAYPOINT_1, WAYPOINT_2], START);
      expect(dur).toBeGreaterThan(0);
    });
  });

  describe("resolveRouteOptions", () => {
    const defaultInput = {
      waypoints: [WAYPOINT_1],
      effectiveStart: START,
      base: "http://osrm",
      railBase: "",
      exclude: [],
      departureTime: new Date().toISOString(),
      signal: new AbortController().signal,
    };

    it("should return empty array if no waypoints", async () => {
      const result = await resolveRouteOptions({ ...defaultInput, waypoints: [] });
      expect(result).toEqual([]);
    });

    it("should fetch alternatives for single mode road route", async () => {
      const mockAlt = {
        distance: 1000,
        duration: 300,
        geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]
      };
      vi.mocked(osrm.fetchAlternatives).mockResolvedValue([mockAlt]);

      const result = await resolveRouteOptions(defaultInput);
      
      expect(osrm.fetchAlternatives).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].distance).toBe(1000);
      expect(result[0].segments).toHaveLength(1);
      expect(result[0].segments[0].mode).toBe("drive");
    });

    it("should fallback to point-to-point if fetch fails", async () => {
      vi.mocked(osrm.fetchAlternatives).mockRejectedValue(new Error("Network error"));

      await expect(resolveRouteOptions(defaultInput)).rejects.toThrow("Network error");
    });

    it("should resolve multi-leg routes individually", async () => {
      const multiInput = { ...defaultInput, waypoints: [WAYPOINT_1, WAYPOINT_2] };
      vi.mocked(transit.isTransitEnabled).mockReturnValue(false);
      vi.mocked(osrm.fetchRoute).mockResolvedValue({
        geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
        distance: 500,
        duration: 150
      });

      const result = await resolveRouteOptions(multiInput);
      
      expect(osrm.fetchRoute).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(2);
      expect(result[0].distance).toBe(1000); // 500 * 2
      expect(result[0].estimated).toBe(false);
    });

    it("should use transit if enabled and mode is train", async () => {
      const trainWaypoint = { ...WAYPOINT_1, mode: "train" as const };
      const multiInput = { ...defaultInput, waypoints: [trainWaypoint] };
      
      vi.mocked(transit.isTransitEnabled).mockReturnValue(true);
      vi.mocked(transit.planTransitJourney).mockResolvedValue({
        geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
        departureMs: 1000000,
        arrivalMs: 1005000,
        label: "RER A"
      });

      const result = await resolveRouteOptions(multiInput);
      
      expect(transit.planTransitJourney).toHaveBeenCalledTimes(1);
      expect(result[0].segments[0].transit?.label).toBe("RER A");
    });
  });
});
