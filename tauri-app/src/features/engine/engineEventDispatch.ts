import { engineEvents } from "../../lib/events";
import type {
  DeviceDetails,
  Diagnostics,
  NetworkDevicesResult,
  Status,
  Telemetry,
} from "../../types/engine";
import { EngineEvent } from "../../types/engineMessages";

// Routing of one inbound {type, data} envelope to the right piece of state.
//
// This used to be a 60-line switch nested inside the socket's onmessage handler
// inside the provider, which meant the mapping — including the LOCATION
// merge-into-navigation-progress, the only non-trivial case — could only be
// exercised by standing up a WebSocket. As a free function taking its side
// effects as arguments, it can be called directly.

export interface EngineEventHandlers {
  setStatus: React.Dispatch<React.SetStateAction<Status | null>>;
  setTelemetry: (t: Telemetry) => void;
  setDeviceDetails: (d: DeviceDetails) => void;
  setDiagnostics: (d: Diagnostics) => void;
  setNetworkDevices: (d: NetworkDevicesResult) => void;
}

// Applies one decoded envelope. Unknown types are ignored on purpose: the
// engine may broadcast events a older client doesn't know yet, and dropping
// them silently is what keeps a version mismatch from being fatal.
export function applyEngineEvent(
  type: string,
  data: any,
  handlers: EngineEventHandlers,
): void {
  switch (type) {
    case EngineEvent.Status:
    case EngineEvent.StatusUpdate:
      handlers.setStatus(data);
      break;
    case EngineEvent.Telemetry:
      handlers.setTelemetry(data);
      break;
    case EngineEvent.DeviceInfo:
      handlers.setDeviceDetails(data);
      break;
    case EngineEvent.Diagnostics:
      handlers.setDiagnostics(data);
      break;
    case EngineEvent.NetworkDevices:
      handlers.setNetworkDevices(data);
      break;
    // These four are consumed by the logs and pairing contexts rather than by
    // the transport, so they are re-emitted instead of stored here.
    case EngineEvent.Log:
      engineEvents.emit("log", data);
      break;
    case EngineEvent.Logs:
      engineEvents.emit("logs", data);
      break;
    case EngineEvent.PairResult:
      engineEvents.emit("pair_result", data);
      break;
    case EngineEvent.PairCode:
      engineEvents.emit("pair_code", data);
      break;
    case EngineEvent.PairedDevices:
      engineEvents.emit("paired_devices", data);
      break;
    case EngineEvent.Location:
      handlers.setStatus((prev) => mergeLocationIntoStatus(prev, data));
      break;
    default:
      break;
  }
}

// LOCATION carries only a position, so it is merged into the existing
// navigation progress rather than replacing it — the index/total/speed of the
// running simulation must survive a position tick. With no status yet there is
// nothing to merge into, and the next STATUS will carry the full picture
// anyway.
export function mergeLocationIntoStatus(
  prev: Status | null,
  data: { lat: number; lon: number },
): Status | null {
  if (!prev) return null;
  return {
    ...prev,
    navigation: {
      ...prev.navigation,
      progress: prev.navigation.progress
        ? { ...prev.navigation.progress, lat: data.lat, lon: data.lon }
        : { index: 0, total: 1, lat: data.lat, lon: data.lon, speed: 0 },
    },
  };
}
