import { describe, it, expect } from "vitest";
import {
  isValidRsdAddress,
  selectQrPairingHost,
  normalizeRoutingPriority,
  moveRoutingProviderPriority,
  buildSettingsPayload,
} from "./settingsModel";
import type { NetworkInterfaceInfo } from "../../types/engine";

describe("settingsModel", () => {
  describe("isValidRsdAddress", () => {
    it("should return true for empty strings (unconfigured)", () => {
      expect(isValidRsdAddress("")).toBe(true);
      expect(isValidRsdAddress("   ")).toBe(true);
    });

    it("should return true for valid ipv4:port formats", () => {
      expect(isValidRsdAddress("192.168.1.100:8080")).toBe(true);
      expect(isValidRsdAddress("10.0.0.1:4000")).toBe(true);
    });

    it("should return false for invalid formats", () => {
      expect(isValidRsdAddress("192.168.1.100")).toBe(false); // missing port
      expect(isValidRsdAddress("localhost:8080")).toBe(false); // not ipv4
      expect(isValidRsdAddress("fe80::1:8080")).toBe(false); // ipv6 not currently matched by regex
    });
  });

  describe("selectQrPairingHost", () => {
    const interfaces: NetworkInterfaceInfo[] = [
      { name: "eth0", ip: "192.168.1.50" },
      { name: "en0", ip: "10.0.0.5" },
    ];

    it("should select the mdnsInterface if it matches", () => {
      expect(selectQrPairingHost(interfaces, "en0")).toBe("10.0.0.5");
    });

    it("should fallback to the first interface if mdnsInterface is not found or null", () => {
      expect(selectQrPairingHost(interfaces, "wlan0")).toBe("192.168.1.50");
      expect(selectQrPairingHost(interfaces, null)).toBe("192.168.1.50");
    });

    it("should return null if there are no interfaces", () => {
      expect(selectQrPairingHost([], "en0")).toBe(null);
    });
  });

  describe("normalizeRoutingPriority", () => {
    it("should append missing default priorities", () => {
      expect(normalizeRoutingPriority(["osrm"])).toEqual(["osrm", "google", "mapbox"]);
      expect(normalizeRoutingPriority([])).toEqual(["google", "mapbox", "osrm"]);
    });

    it("should not modify complete priority lists", () => {
      expect(normalizeRoutingPriority(["mapbox", "osrm", "google"])).toEqual(["mapbox", "osrm", "google"]);
    });
  });

  describe("moveRoutingProviderPriority", () => {
    it("should move a provider up", () => {
      const start = ["google", "mapbox", "osrm"] as const;
      expect(moveRoutingProviderPriority([...start], "mapbox", -1)).toEqual(["mapbox", "google", "osrm"]);
    });

    it("should move a provider down", () => {
      const start = ["google", "mapbox", "osrm"] as const;
      expect(moveRoutingProviderPriority([...start], "google", 1)).toEqual(["mapbox", "google", "osrm"]);
    });

    it("should do nothing if at the bounds", () => {
      const start = ["google", "mapbox", "osrm"] as const;
      expect(moveRoutingProviderPriority([...start], "google", -1)).toEqual(start);
      expect(moveRoutingProviderPriority([...start], "osrm", 1)).toEqual(start);
    });
  });

  describe("buildSettingsPayload", () => {
    it("should build the correct EngineSettings payload", () => {
      const input = {
        companionPort: "8080",
        preferredDriver: "go-ios",
        isEveilMode: true,
        eveilInterval: "15",
        jitterEnabled: false,
        osrmBaseUrl: " http://router.project-osrm.org ",
        routingMode: "auto" as const,
        routingProvider: "osrm" as const,
        routingPriority: ["osrm", "google", "mapbox"] as const,
        googleRoutesApiKey: "  test_key  ",
        mapboxAccessToken: "",
        clusterHeartbeat: "3",
        clusterMasterDead: "10",
        clusterPeerTimeout: "30",
      };

      const result = buildSettingsPayload(input);

      expect(result).toEqual({
        companionPort: 8080,
        preferredDriver: "go-ios",
        isEveilMode: true,
        eveilInterval: 15,
        jitterEnabled: false,
        osrmBaseUrl: "http://router.project-osrm.org",
        routingMode: "auto",
        routingProvider: "osrm",
        routingProviderPriority: ["osrm", "google", "mapbox"],
        googleRoutesApiKey: "test_key",
        clusterHeartbeatSeconds: 3,
        clusterMasterDeadSeconds: 10,
        clusterPeerTimeoutSeconds: 30,
      });

      expect(result.mapboxAccessToken).toBeUndefined(); // Should omit empty strings
    });
  });
});
