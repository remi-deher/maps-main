import type {
  EngineMessageData,
  PatrolZone,
  PlaySequenceLeg,
  RouteProfile,
  Settings,
} from "../../types/engine";
import { EngineAction } from "../../types/engineMessages";

// The typed action surface, built on top of a single send function.
//
// These were ~25 one-line methods declared inline in the provider, each doing
// nothing but naming an EngineAction and shaping its payload. Gathering them
// here keeps the provider to the transport concerns and puts the whole
// vocabulary the UI can speak in one readable place — next to the enum it
// mirrors.

export interface EngineActionDeps {
  send: (type: string, data?: EngineMessageData) => boolean;
  // The three "get" actions clear their previous result first, so the UI shows
  // a loading state instead of stale data while the reply is in flight.
  clearDeviceDetails: () => void;
  clearDiagnostics: () => void;
  clearNetworkDevices: () => void;
}

export function createEngineActions({
  send,
  clearDeviceDetails,
  clearDiagnostics,
  clearNetworkDevices,
}: EngineActionDeps) {
  return {
    setLocation: (lat: number, lon: number, name = "Point Injecté") =>
      send(EngineAction.SetLocation, { lat, lon, name }),
    clearLocation: () => send(EngineAction.ClearLocation),

    playRoute: (endLat: number, endLon: number, speed: number, profile: RouteProfile) =>
      send(EngineAction.PlayRoute, { endLat, endLon, speed, profile }),
    playSequence: (legs: PlaySequenceLeg[], looping: boolean) =>
      send(EngineAction.PlaySequence, { legs, looping }),
    playCustomGpx: (gpxContent: string, speed: number) =>
      send(EngineAction.PlayCustomGpx, { gpxContent, speed }),
    stopRoute: () => send(EngineAction.StopRoute),
    pauseRoute: () => send(EngineAction.PauseRoute),
    resumeRoute: () => send(EngineAction.ResumeRoute),
    relance: () => send(EngineAction.Relance),

    saveSettings: (newSettings: Settings) => send(EngineAction.SaveSettings, newSettings),

    addFavorite: (lat: number, lon: number, name: string) =>
      send(EngineAction.AddFavorite, { lat, lon, name }),
    removeFavorite: (lat: number, lon: number) => send(EngineAction.RemoveFavorite, { lat, lon }),
    renameFavorite: (lat: number, lon: number, newName: string) =>
      send(EngineAction.RenameFavorite, { lat, lon, newName }),

    updatePatrolZone: (zone: PatrolZone | null) => send(EngineAction.PatrolUpdate, { zone }),

    getDeviceInfo: () => {
      clearDeviceDetails();
      send(EngineAction.GetDeviceInfo);
    },
    getDiagnostics: () => {
      clearDiagnostics();
      send(EngineAction.GetDiagnostics);
    },
    getNetworkDevices: () => {
      clearNetworkDevices();
      send(EngineAction.GetNetworkDevices);
    },

    restartServices: () => send(EngineAction.RestartServices),
    restartTunnel: () => send(EngineAction.RestartTunnel),
    restartMdns: () => send(EngineAction.RestartMdns),
  };
}
