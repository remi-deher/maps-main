import { describe, it, expect } from "vitest";
import { osrmBaseUrl, haversineMeters } from "./osrm";
import type { LatLon } from "../types/engine";

describe("osrm", () => {
  describe("osrmBaseUrl", () => {
    it("returns public fallback when not configured", () => {
      expect(osrmBaseUrl()).toBe("https://router.project-osrm.org");
      expect(osrmBaseUrl("")).toBe("https://router.project-osrm.org");
      expect(osrmBaseUrl("   ")).toBe("https://router.project-osrm.org");
    });

    it("returns configured url and strips trailing slash", () => {
      expect(osrmBaseUrl("http://localhost:5000")).toBe("http://localhost:5000");
      expect(osrmBaseUrl("http://localhost:5000/")).toBe("http://localhost:5000");
      expect(osrmBaseUrl("  http://localhost:5000/  ")).toBe("http://localhost:5000");
    });
  });

  describe("haversineMeters", () => {
    it("calculates correct distance between two points", () => {
      const paris: LatLon = { lat: 48.8566, lon: 2.3522 };
      const london: LatLon = { lat: 51.5074, lon: -0.1278 };
      
      const distance = haversineMeters(paris, london);
      // Distance is ~344km
      expect(distance).toBeGreaterThan(340000);
      expect(distance).toBeLessThan(350000);
      
      // Distance to self should be 0
      expect(haversineMeters(paris, paris)).toBeCloseTo(0);
    });
  });
});
