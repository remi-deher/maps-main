/**
 * Utility for fetching routes from OSRM
 */

const OSRM_PROFILES = {
  walk: 'walking',
  drive: 'driving',
  cycling: 'cycling'
};

export async function fetchRoute(start, end, type = 'drive', options = {}) {
  if (type === 'flight' || type === 'wait' || !OSRM_PROFILES[type]) {
    return null;
  }

  const profile = OSRM_PROFILES[type];
  let url = `https://router.project-osrm.org/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;

  if (options.exclude) {
    url += `&exclude=${options.exclude}`; // e.g. toll,motorway,ferry
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        path: route.geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] })),
        duration: route.duration,
        distance: route.distance
      };
    }
  } catch (e) {
    console.error('[routing] OSRM error:', e);
  }
  return null;
}

export async function snapToRoad(lat, lon, type = 'drive') {
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

export async function optimizeRoute(points, type = 'drive') {
  if (points.length < 2) return null;
  const profile = OSRM_PROFILES[type] || 'driving';
  const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/trip/v1/${profile}/${coords}?overview=full&geometries=geojson&source=first&destination=last`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.trips && data.trips.length > 0) {
      // Retourne l'ordre optimisé des waypoints et la géométrie
      return {
        geometry: data.trips[0].geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] })),
        waypointIndices: data.waypoints.sort((a, b) => a.waypoint_index - b.waypoint_index).map(w => w.trips_index)
      };
    }
  } catch (e) {
    console.error('[routing] Trip error:', e);
  }
  return null;
}
