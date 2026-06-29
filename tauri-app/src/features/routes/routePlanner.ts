import type { LatLon, PlaySequenceLeg } from "../../types/engine";
import { fetchAlternatives, fetchRoute, haversineMeters, makeWaitLeg, simplifyGeometry, straightLineRoute } from "../../lib/osrm";
import { isTransitEnabled, planTransitJourney } from "../../lib/transit";
import {
  BACKEND_LEG_TYPE,
  isRoadRoutable,
  MODE_DEFAULT_KMH,
  OSRM_PROFILE,
  type LegMode,
  type RouteOption,
  type RouteSegment,
  type Waypoint,
} from "./routeModel";

interface ResolveRouteOptionsInput {
  waypoints: Waypoint[];
  effectiveStart: LatLon;
  base: string;
  railBase: string;
  exclude: string[];
  departureTime: string;
  signal: AbortSignal;
}

export interface StopSchedule {
  arrival: Date;
  departure: Date;
  wait: number;
  label?: string;
}

const parseDepartureMs = (departureTime: string): number => {
  const parsed = new Date(departureTime);
  return isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
};

async function resolveLeg(
  from: LatLon,
  to: LatLon,
  mode: LegMode,
  base: string,
  railBase: string,
  exclude: string[],
  signal: AbortSignal
): Promise<{ coords: LatLon[]; distance: number; duration: number; estimated: boolean }> {
  const kmh = MODE_DEFAULT_KMH[mode];
  try {
    if (isRoadRoutable(mode)) {
      const route = await fetchRoute(base, [from, to], OSRM_PROFILE[mode]!, { signal, exclude });
      return { coords: route.geometry, distance: route.distance, duration: route.duration, estimated: false };
    }
    if (mode === "train" && railBase) {
      const route = await fetchRoute(railBase, [from, to], "driving", { signal });
      return { coords: route.geometry, distance: route.distance, duration: route.duration, estimated: false };
    }
    const fallback = straightLineRoute(from, to, kmh);
    return { coords: fallback.geometry, distance: fallback.distance, duration: fallback.duration, estimated: mode === "train" };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    const fallback = straightLineRoute(from, to, kmh);
    return { coords: fallback.geometry, distance: fallback.distance, duration: fallback.duration, estimated: true };
  }
}

export async function resolveRouteOptions(input: ResolveRouteOptionsInput): Promise<RouteOption[]> {
  const { waypoints, effectiveStart, base, railBase, exclude, departureTime, signal } = input;
  if (waypoints.length === 0) return [];

  const singleMode = waypoints.every((waypoint) => waypoint.mode === waypoints[0].mode);
  const altEligible = singleMode && isRoadRoutable(waypoints[0].mode);

  if (altEligible) {
    const mode = waypoints[0].mode;
    const alternatives = await fetchAlternatives(base, [effectiveStart, ...waypoints], OSRM_PROFILE[mode]!, { signal, exclude });
    return alternatives.map((alternative) => ({
      distance: alternative.distance,
      duration: alternative.duration,
      estimated: false,
      segments: [{ coords: alternative.geometry, mode }],
    }));
  }

  const legs = waypoints.map((waypoint, index) => ({
    from: index === 0 ? effectiveStart : waypoints[index - 1],
    to: waypoint,
    mode: waypoint.mode,
  }));
  const transitOn = isTransitEnabled();
  const segments: RouteSegment[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let anyEstimated = false;
  let clock = parseDepartureMs(departureTime);

  for (let index = 0; index < legs.length; index++) {
    const { from, to, mode } = legs[index];
    let coords: LatLon[];
    let distance: number;
    let duration: number;
    let estimated = false;
    let transit: RouteSegment["transit"];

    if (mode === "train" && transitOn) {
      const journey = await planTransitJourney(from, to, new Date(clock), signal);
      if (signal.aborted) return [];
      if (journey) {
        coords = journey.geometry;
        duration = Math.max(1, (journey.arrivalMs - journey.departureMs) / 1000);
        distance = haversineMeters(from, to);
        transit = { departureMs: journey.departureMs, arrivalMs: journey.arrivalMs, label: journey.label };
        clock = journey.arrivalMs;
      } else {
        const route = await resolveLeg(from, to, mode, base, railBase, exclude, signal);
        if (signal.aborted) return [];
        ({ coords, distance, duration } = route);
        estimated = true;
        clock += duration * 1000;
      }
    } else {
      const route = await resolveLeg(from, to, mode, base, railBase, exclude, signal);
      if (signal.aborted) return [];
      ({ coords, distance, duration, estimated } = route);
      clock += duration * 1000;
    }

    const nextIsTransitTrain = index + 1 < legs.length && legs[index + 1].mode === "train" && transitOn;
    if (!nextIsTransitTrain) clock += (waypoints[index].waitMinutes ?? 0) * 60000;

    segments.push({ coords, mode, duration, transit });
    totalDistance += distance;
    totalDuration += duration;
    anyEstimated = anyEstimated || estimated;
  }

  return [{ distance: totalDistance, duration: totalDuration, estimated: anyEstimated, segments }];
}

export function calculateHaversineTotal(waypoints: Waypoint[], effectiveStart: LatLon): number {
  return waypoints.reduce((total, waypoint, index) => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    return total + haversineMeters(from, waypoint);
  }, 0);
}

export function calculateFallbackDurationSeconds(waypoints: Waypoint[], effectiveStart: LatLon): number {
  return waypoints.reduce((total, waypoint, index) => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    const distance = haversineMeters(from, waypoint);
    return total + distance / ((MODE_DEFAULT_KMH[waypoint.mode] * 1000) / 3600);
  }, 0);
}

export function calculateStopSchedule(
  waypoints: Waypoint[],
  effectiveStart: LatLon,
  selectedRoute: RouteOption | null,
  departureTime: string,
  haversineTotal: number
): StopSchedule[] {
  const departureBase = new Date(departureTime);
  let clock = isNaN(departureBase.getTime()) ? Date.now() : departureBase.getTime();
  const segments = selectedRoute && selectedRoute.segments.length === waypoints.length ? selectedRoute.segments : null;
  const out: StopSchedule[] = [];

  const legTravelSeconds = (index: number): number => {
    const from = index === 0 ? effectiveStart : waypoints[index - 1];
    const waypoint = waypoints[index];
    if (segments) return segments[index].duration ?? 0;
    if (selectedRoute && haversineTotal > 0) {
      return selectedRoute.duration * (haversineMeters(from, waypoint) / haversineTotal);
    }
    return haversineMeters(from, waypoint) / ((MODE_DEFAULT_KMH[waypoint.mode] * 1000) / 3600);
  };

  for (let index = 0; index < waypoints.length; index++) {
    const segment = segments?.[index];
    const arrivalMs = segment?.transit ? segment.transit.arrivalMs : clock + legTravelSeconds(index) * 1000;
    const nextSegment = segments?.[index + 1];
    let departureMs: number;
    let waitMinutes: number;

    if (index < waypoints.length - 1 && nextSegment?.transit) {
      departureMs = nextSegment.transit.departureMs;
      waitMinutes = Math.max(0, Math.round((departureMs - arrivalMs) / 60000));
    } else {
      waitMinutes = waypoints[index].waitMinutes ?? 0;
      departureMs = arrivalMs + waitMinutes * 60000;
    }

    out.push({ arrival: new Date(arrivalMs), departure: new Date(departureMs), wait: waitMinutes, label: segment?.transit?.label });
    clock = departureMs;
  }

  return out;
}

export function buildPlaybackLegs(
  waypoints: Waypoint[],
  effectiveStart: LatLon,
  selectedRoute: RouteOption | null,
  schedule: StopSchedule[],
  speedFactor: number
): PlaySequenceLeg[] {
  const perLegSegments = selectedRoute && selectedRoute.segments.length === waypoints.length ? selectedRoute.segments : null;
  const lastIndex = waypoints.length - 1;

  return waypoints.flatMap((waypoint, index) => {
    const from = index === 0 ? effectiveStart : { lat: waypoints[index - 1].lat, lon: waypoints[index - 1].lon };
    const end = { lat: waypoint.lat, lon: waypoint.lon };
    const legKmh = MODE_DEFAULT_KMH[waypoint.mode] * speedFactor;
    const base = { speed: legKmh, startTime: Date.now(), endTime: Date.now() + 60000 };

    let travel: PlaySequenceLeg[];
    if (waypoint.mode === "train") {
      const geometry = perLegSegments?.[index]?.coords ?? [from, end];
      const path = geometry.length > 2 ? simplifyGeometry(geometry, 60) : [from, end];
      travel = path.slice(0, -1).map((point, segmentIndex) => ({ type: "flight", start: point, end: path[segmentIndex + 1], ...base }));
    } else {
      travel = [{ type: BACKEND_LEG_TYPE[waypoint.mode], start: from, end, ...base }];
    }

    const waitSeconds = index < lastIndex ? Math.round((schedule[index]?.wait ?? 0) * 60) : 0;
    return waitSeconds > 0 ? [...travel, makeWaitLeg(end, waitSeconds)] : travel;
  });
}
