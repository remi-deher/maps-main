// Real public-transit timetables via Transitous (https://transitous.org), a
// free, key-less MOTIS-based routing service. Used to resolve TRAIN legs with
// real rail geometry, real departure/arrival times and the train name.
//
// Frontend-only: like the rail-router URL, the engine never calls this — the
// frontend fetches the journey for preview + schedule + playback expansion.

import { LatLon } from "../context/websocket";

const DEFAULT_BASE = "https://api.transitous.org";
const ENABLED_KEY = "gpsmock.transitEnabled";
const BASE_KEY = "gpsmock.transitBaseUrl";

export function isTransitEnabled(): boolean {
  try {
    // Default ON — it's free and key-less; per-train-leg only, with fallback.
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setTransitEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function transitBase(): string {
  try {
    return (localStorage.getItem(BASE_KEY)?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE;
  }
}

export function getTransitBaseUrl(): string {
  try {
    return localStorage.getItem(BASE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setTransitBaseUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(BASE_KEY, url.trim());
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* ignore */
  }
}

/// Decodes an encoded polyline (Google algorithm) at the given precision.
function decodePolyline(encoded: string, precision: number): LatLon[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: LatLon[] = [];
  const factor = Math.pow(10, precision);
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ lat: lat / factor, lon: lng / factor });
  }
  return coords;
}

export interface TransitJourney {
  /// Real departure time of the train (epoch ms).
  departureMs: number;
  /// Real arrival time at the destination station (epoch ms).
  arrivalMs: number;
  /// Continuous geometry of the whole journey (short access walks + rail).
  geometry: LatLon[];
  /// e.g. "TGV 6613" — the first rail leg's short name.
  label?: string;
}

const isRailMode = (mode: string): boolean => /RAIL|TRAIN|SUBWAY|TRAM/i.test(mode);

/// Plans the earliest rail journey from `from` to `to` departing at/after
/// `departAfter`. Returns null if none is found / the request fails.
export async function planTransitJourney(
  from: LatLon,
  to: LatLon,
  departAfter: Date,
  signal?: AbortSignal
): Promise<TransitJourney | null> {
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    time: departAfter.toISOString(),
    transitModes: "RAIL",
  });
  try {
    const res = await fetch(`${transitBase()}/api/v1/plan?${params.toString()}`, { signal });
    const data = await res.json();
    const itin = data?.itineraries?.[0];
    if (!itin || !Array.isArray(itin.legs)) return null;

    const railLegs = itin.legs.filter((l: any) => isRailMode(l.mode));
    if (railLegs.length === 0) return null;

    const geometry: LatLon[] = [];
    itin.legs.forEach((leg: any, i: number) => {
      const g = leg.legGeometry;
      if (!g?.points) return;
      const pts = decodePolyline(g.points, g.precision ?? 5);
      // Drop the duplicated junction point between consecutive legs.
      pts.forEach((p, j) => {
        if (i > 0 && j === 0 && geometry.length > 0) return;
        geometry.push(p);
      });
    });

    const dep = railLegs[0].from?.departure ?? railLegs[0].startTime;
    const arr = railLegs[railLegs.length - 1].to?.arrival ?? railLegs[railLegs.length - 1].endTime;
    return {
      departureMs: new Date(dep).getTime(),
      arrivalMs: new Date(arr).getTime(),
      geometry: geometry.length > 1 ? geometry : [from, to],
      label: railLegs[0].routeShortName || railLegs[0].tripShortName || undefined,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    return null;
  }
}
