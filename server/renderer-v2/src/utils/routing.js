/**
 * Utility for fetching routes from OSRM
 */

const OSRM_PROFILES = {
  walk: 'walking',
  drive: 'driving',
  cycling: 'cycling'
};

export async function fetchRoute(start, end, type = 'drive') {
  if (type === 'flight' || type === 'wait' || !OSRM_PROFILES[type]) {
    return null;
  }

  const profile = OSRM_PROFILES[type];
  const url = `https://router.project-osrm.org/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      return data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] }));
    }
  } catch (e) {
    console.error('[routing] OSRM error:', e);
  }
  return null;
}
