/**
 * Utility for fetching routes from OSRM on mobile
 */

const OSRM_PROFILES: Record<string, string> = {
  walk: 'walking',
  drive: 'driving',
  cycling: 'cycling'
};

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface RouteResult {
  path: RoutePoint[];
  duration: number;
  distance: number;
}

export async function fetchRoute(start: RoutePoint, end: RoutePoint, type: string = 'drive', options: any = {}): Promise<RouteResult | null> {
  if (type === 'flight' || type === 'wait' || !OSRM_PROFILES[type]) {
    return null;
  }

  const profile = OSRM_PROFILES[type];
  let url = `https://router.project-osrm.org/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;

  if (options.exclude) {
    url += `&exclude=${options.exclude}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        path: route.geometry.coordinates.map((c: [number, number]) => ({ lat: c[1], lon: c[0] })),
        duration: route.duration,
        distance: route.distance
      };
    }
  } catch (e) {
    console.error('[routing] OSRM error:', e);
  }
  return null;
}

export async function snapToRoad(lat: number, lon: number, type: string = 'drive') {
  const profile = OSRM_PROFILES[type] || 'driving';
  const url = `https://router.project-osrm.org/nearest/v1/${profile}/${lon},${lat}?number=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.waypoints && data.waypoints.length > 0) {
      const wp = data.waypoints[0];
      return {
        lat: wp.location[1],
        lon: wp.location[0],
        name: wp.name
      };
    }
  } catch (e) {
    console.error('[routing] Snap error:', e);
  }
  return null;
}

export async function optimizeRoute(points: (RoutePoint & { id: string })[], type: string = 'drive') {
  if (points.length < 3) return null;
  const profile = OSRM_PROFILES[type] || 'driving';
  // L'ordre des points est important : source=first&destination=last force le départ et l'arrivée
  const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/trip/v1/${profile}/${coords}?overview=full&geometries=geojson&source=first&destination=last`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.trips && data.trips.length > 0) {
      // Les waypoints dans la réponse indiquent le nouvel ordre (waypoint_index est l'ordre original, trips_index est la position dans le voyage optimisé)
      // On veut réordonner nos objets originaux
      const sortedPoints = [...points];
      data.waypoints.forEach((wp: any) => {
        sortedPoints[wp.trips_index] = points[wp.waypoint_index];
      });
      return sortedPoints;
    }
  } catch (e) {
    console.error('[routing] Trip optimization error:', e);
  }
  return null;
}
