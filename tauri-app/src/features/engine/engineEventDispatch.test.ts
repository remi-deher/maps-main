import { describe, expect, it, vi } from "vitest";
import { applyEngineEvent, mergeLocationIntoStatus } from "./engineEventDispatch";
import { engineEvents } from "../../lib/events";
import { EngineEvent } from "../../types/engineMessages";
import type { Status } from "../../types/engine";

const handlers = () => ({
  setStatus: vi.fn(),
  setTelemetry: vi.fn(),
  setDeviceDetails: vi.fn(),
  setDiagnostics: vi.fn(),
  setNetworkDevices: vi.fn(),
});

const baseStatus = (progress: Status["navigation"]["progress"]): Status =>
  ({ state: "moving", navigation: { progress } }) as unknown as Status;

describe("applyEngineEvent", () => {
  it("routes each stored event to its own slice of state", () => {
    const h = handlers();

    applyEngineEvent(EngineEvent.Status, { state: "ready" }, h);
    applyEngineEvent(EngineEvent.Telemetry, { uptime: 12 }, h);
    applyEngineEvent(EngineEvent.DeviceInfo, { name: "iPhone" }, h);
    applyEngineEvent(EngineEvent.Diagnostics, { lockdownDir: "/x" }, h);
    applyEngineEvent(EngineEvent.NetworkDevices, { devices: [] }, h);

    expect(h.setStatus).toHaveBeenCalledWith({ state: "ready" });
    expect(h.setTelemetry).toHaveBeenCalledWith({ uptime: 12 });
    expect(h.setDeviceDetails).toHaveBeenCalledWith({ name: "iPhone" });
    expect(h.setDiagnostics).toHaveBeenCalledWith({ lockdownDir: "/x" });
    expect(h.setNetworkDevices).toHaveBeenCalledWith({ devices: [] });
  });

  it("treats STATUS_UPDATE the same as STATUS", () => {
    const h = handlers();
    applyEngineEvent(EngineEvent.StatusUpdate, { state: "paused" }, h);
    expect(h.setStatus).toHaveBeenCalledWith({ state: "paused" });
  });

  // Logs and pairing are owned by their own contexts, so the transport
  // re-emits rather than storing them.
  it.each([
    [EngineEvent.Log, "log"],
    [EngineEvent.Logs, "logs"],
    [EngineEvent.PairResult, "pair_result"],
    [EngineEvent.PairCode, "pair_code"],
    [EngineEvent.PairedDevices, "paired_devices"],
  ])("re-emits %s as the %s event", (engineEvent, emitted) => {
    const listener = vi.fn();
    engineEvents.on(emitted as any, listener);
    applyEngineEvent(engineEvent, { some: "payload" }, handlers());
    engineEvents.off(emitted as any, listener);

    expect(listener).toHaveBeenCalledWith({ some: "payload" });
  });

  // A newer engine may broadcast events this client doesn't know. Dropping them
  // silently is what keeps a version mismatch from breaking the session.
  it("ignores an unknown event type without touching any state", () => {
    const h = handlers();
    applyEngineEvent("SOMETHING_NEW", { anything: true }, h);

    for (const fn of Object.values(h)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("mergeLocationIntoStatus", () => {
  // The whole point of the merge: a LOCATION tick carries only a position, so
  // the running simulation's index/total/speed have to survive it.
  it("updates the position while preserving the rest of the progress", () => {
    const merged = mergeLocationIntoStatus(
      baseStatus({ index: 7, total: 20, lat: 1, lon: 2, speed: 50 }),
      { lat: 48.8566, lon: 2.3522 },
    );

    expect(merged?.navigation.progress).toEqual({
      index: 7,
      total: 20,
      lat: 48.8566,
      lon: 2.3522,
      speed: 50,
    });
  });

  it("seeds a progress block when none exists yet", () => {
    const merged = mergeLocationIntoStatus(baseStatus(null), { lat: 10, lon: 20 });

    expect(merged?.navigation.progress).toEqual({
      index: 0,
      total: 1,
      lat: 10,
      lon: 20,
      speed: 0,
    });
  });

  // Nothing to merge into before the first STATUS; that STATUS will carry the
  // full picture anyway.
  it("stays null when no status has arrived", () => {
    expect(mergeLocationIntoStatus(null, { lat: 1, lon: 2 })).toBeNull();
  });
});
