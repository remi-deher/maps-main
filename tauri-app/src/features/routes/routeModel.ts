import type { LatLon } from "../../types/engine";
import { autoLegMode, type PlaceKind } from "../../lib/geocoding";

export type LegMode = "drive" | "walk" | "train" | "flight";

export interface Waypoint extends LatLon {
  id: string;
  name: string;
  mode: LegMode;
  kind?: PlaceKind;
  waitMinutes?: number;
}

export type AddMethod = "search" | "map" | "coords";

export interface RouteSegment {
  coords: LatLon[];
  mode: LegMode;
  duration?: number;
  transit?: { departureMs: number; arrivalMs: number; label?: string };
}

export interface RouteOption {
  distance: number;
  duration: number;
  estimated: boolean;
  segments: RouteSegment[];
}

export const MODE_ORDER: LegMode[] = ["drive", "walk", "train", "flight"];

export const OSRM_PROFILE: Partial<Record<LegMode, string>> = { drive: "driving", walk: "foot" };

export const MODE_DEFAULT_KMH: Record<LegMode, number> = { drive: 50, walk: 5, train: 120, flight: 800 };

export const BACKEND_LEG_TYPE: Record<LegMode, string> = {
  drive: "drive",
  walk: "walk",
  train: "flight",
  flight: "flight",
};

export const makeWaypointId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const isRoadRoutable = (mode: LegMode): boolean => mode === "drive" || mode === "walk";

export const defaultDwellMinutes = (kind: PlaceKind | null | undefined): number =>
  kind === "airport" ? 60 : kind === "station" ? 10 : 0;

export const suggestLegMode = (previousKind: PlaceKind | null | undefined, nextKind: PlaceKind | null | undefined): LegMode | null =>
  autoLegMode(previousKind ?? null, nextKind ?? null) as LegMode | null;

export function formatDuration(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}
