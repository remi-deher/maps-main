import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTransitEnabled, getTransitBaseUrl } from "./transit";

describe("transit", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isTransitEnabled", () => {
    it("returns true by default", () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      expect(isTransitEnabled()).toBe(true);
    });

    it("returns false if explicitly disabled", () => {
      vi.mocked(localStorage.getItem).mockReturnValue("0");
      expect(isTransitEnabled()).toBe(false);
    });

    it("returns true if explicitly enabled", () => {
      vi.mocked(localStorage.getItem).mockReturnValue("1");
      expect(isTransitEnabled()).toBe(true);
    });
  });

  describe("getTransitBaseUrl", () => {
    it("returns empty string by default", () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      expect(getTransitBaseUrl()).toBe("");
    });

    it("returns configured value", () => {
      vi.mocked(localStorage.getItem).mockReturnValue("http://custom");
      expect(getTransitBaseUrl()).toBe("http://custom");
    });
  });
});
