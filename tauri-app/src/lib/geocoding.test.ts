import { describe, it, expect } from "vitest";
import { placeKind, autoLegMode } from "./geocoding";

describe("geocoding", () => {
  describe("placeKind", () => {
    it("identifies airports", () => {
      expect(placeKind("aeroway", "aerodrome")).toBe("airport");
      expect(placeKind("highway", "terminal")).toBe("airport");
    });

    it("identifies train stations", () => {
      expect(placeKind("railway", "station")).toBe("station");
      expect(placeKind("railway", "halt")).toBe("station");
      expect(placeKind("building", "train_station")).toBe("station");
    });

    it("returns null for other types", () => {
      expect(placeKind("amenity", "restaurant")).toBeNull();
      expect(placeKind("highway", "bus_stop")).toBeNull();
    });
  });

  describe("autoLegMode", () => {
    it("returns train when both are stations", () => {
      expect(autoLegMode("station", "station")).toBe("train");
    });

    it("returns flight when both are airports", () => {
      expect(autoLegMode("airport", "airport")).toBe("flight");
    });

    it("returns null for mismatched or null kinds", () => {
      expect(autoLegMode("station", "airport")).toBeNull();
      expect(autoLegMode("station", null)).toBeNull();
      expect(autoLegMode(null, null)).toBeNull();
    });
  });
});
