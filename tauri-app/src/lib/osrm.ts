// OSRM routing helpers (route + alternatives, TSP order optimization, nearest-
// road snapping). Centralised so RouteModePanel stays focused on UI state.
//
// Base URL: the configured self-hosted server, else the public demo instance
// (car-only, no exclude/foot guarantees). https so the Tauri webview's secure
// context doesn't block it as mixed content.

import type { LatLon } from "../types/engine";

const PUBLIC_OSRM_FALLBACK = "https://router.project-osrm.org";

export interface OsrmRoute {
  distance: number; // meters
  duration: number; // seconds
  geometry: LatLon[];
  /// True when the route includes straight-line fallback legs (mixed-mode path
  /// where some legs couldn't be resolved by OSRM).
  partial?: boolean;
}

export function osrmBaseUrl(configured?: string): string {
  return (configured?.trim() || PUBLIC_OSRM_FALLBACK).replace(/\/$/, "");
}

// Rail router URL is a frontend-only setting (the engine never uses it — the
// frontend resolves rail geometry for preview + sub-leg playback expansion),
// so it lives in localStorage rather than the engine-stored settings.
const RAIL_URL_KEY = "gpsmock.railRouterUrl";

export function getRailRouterUrl(): string {
  try {
    return localStorage.getItem(RAIL_URL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setRailRouterUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(RAIL_URL_KEY, url.trim());
    else localStorage.removeItem(RAIL_URL_KEY);
  } catch {
    /* ignore storage failures */
  }
}

/// Great-circle distance in meters between two points.
export function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/// Synthetic straight-line "route" (for flight / train-without-rail-router) —
/// geometry is just [from, to], duration = distance ÷ the given speed. Matches
/// what the engine's `flight` leg actually plays (straight lat/lon interpolation).
export function straightLineRoute(from: LatLon, to: LatLon, kmh: number): OsrmRoute {
  const distance = haversineMeters(from, to);
  const speedMs = (Math.max(kmh, 1) * 1000) / 3600;
  return { distance, duration: distance / speedMs, geometry: [from, to] };
}

/// Down-samples a geometry to at most `maxPoints` points (keeps first + last),
/// so expanding a leg into per-segment sub-legs stays under the engine's leg cap.
export function simplifyGeometry(coords: LatLon[], maxPoints: number): LatLon[] {
  if (coords.length <= maxPoints || maxPoints < 2) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const out: LatLon[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(coords[Math.round(i * step)]);
  out[out.length - 1] = coords[coords.length - 1];
  return out;
}

/// Builds a "wait" leg that holds (near-)stationary for `seconds`, without any
/// engine change: the engine plays a `flight` leg at 1 pt/s, so a ~1 m segment
/// crossed at 3.6/seconds km/h yields ≈`seconds` points all within ~1 m of `at`.
export function makeWaitLeg(at: LatLon, seconds: number): {
  type: string;
  start: LatLon;
  end: LatLon;
  speed: number;
  startTime: number;
  endTime: number;
} {
  const secs = Math.max(1, Math.round(seconds));
  // ~1 m north (1° lat ≈ 111320 m). Drift over the whole wait stays ~1 m.
  const end = { lat: at.lat + 1 / 111320, lon: at.lon };
  return { type: "flight", start: at, end, speed: 3.6 / secs, startTime: Date.now(), endTime: Date.now() + secs * 1000 };
}

const coordStr = (points: LatLon[]): string => points.map((p) => `${p.lon},${p.lat}`).join(";");

const excludeParam = (exclude?: string[]): string =>
  exclude && exclude.length ? `&exclude=${exclude.join(",")}` : "";

const toLatLon = (coords: [number, number][]): LatLon[] =>
  coords.map(([lon, lat]) => ({ lat, lon }));

interface RouteOpts {
  signal?: AbortSignal;
  exclude?: string[];
}

/// One route through the given points (no alternatives). Throws on failure.
export async function fetchRoute(base: string, points: LatLon[], profile: string, opts: RouteOpts = {}): Promise<OsrmRoute> {
  const url = `${base}/route/v1/${profile}/${coordStr(points)}?overview=full&geometries=geojson${excludeParam(opts.exclude)}`;
  const res = await fetch(url, { signal: opts.signal });
  const data = await res.json();
  const route = data?.routes?.[0];
  if (data.code !== "Ok" || !route) throw new Error("OSRM: pas de route trouvée");
  return { distance: route.distance, duration: route.duration, geometry: toLatLon(route.geometry.coordinates) };
}

/// Up to ~3 alternative routes through the points (single profile only).
export async function fetchAlternatives(base: string, points: LatLon[], profile: string, opts: RouteOpts = {}): Promise<OsrmRoute[]> {
  const url = `${base}/route/v1/${profile}/${coordStr(points)}?overview=full&geometries=geojson&alternatives=3${excludeParam(opts.exclude)}`;
  const res = await fetch(url, { signal: opts.signal });
  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error("OSRM: pas de route trouvée");
  }
  return data.routes.map((route: any): OsrmRoute => ({
    distance: route.distance,
    duration: route.duration,
    geometry: toLatLon(route.geometry.coordinates),
  }));
}

/// Optimized order of the stops (TSP) keeping `start` fixed as the origin.
/// Returns indices into `stops` in their new optimal order.
export async function fetchOptimizedStopOrder(
  base: string,
  start: LatLon,
  stops: LatLon[],
  profile: string,
  opts: RouteOpts = {}
): Promise<number[]> {
  const points = [start, ...stops];
  const url = `${base}/trip/v1/${profile}/${coordStr(points)}?source=first&roundtrip=false${excludeParam(opts.exclude)}`;
  const res = await fetch(url, { signal: opts.signal });
  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.waypoints)) throw new Error("OSRM: optimisation échouée");
  // waypoints[i].waypoint_index = position of input coord i in the optimized
  // trip. Input 0 is the fixed start; stops are inputs 1..n.
  const ordered = stops
    .map((_, i) => ({ stopIndex: i, order: data.waypoints[i + 1]?.waypoint_index ?? i + 1 }))
    .sort((a, b) => a.order - b.order);
  return ordered.map((o) => o.stopIndex);
}

/// Snaps a coordinate to the nearest routable road. Returns null on failure
/// (caller keeps the raw coordinate).
export async function snapToRoad(base: string, lat: number, lon: number, profile: string, signal?: AbortSignal): Promise<LatLon | null> {
  try {
    const res = await fetch(`${base}/nearest/v1/${profile}/${lon},${lat}?number=1`, { signal });
    const data = await res.json();
    const wp = data?.waypoints?.[0];
    if (data.code !== "Ok" || !wp?.location) return null;
    return { lat: wp.location[1], lon: wp.location[0] };
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    return null;
  }
}
