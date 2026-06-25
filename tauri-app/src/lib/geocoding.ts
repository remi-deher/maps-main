// Shared Nominatim (OpenStreetMap) geocoding helpers — forward search and
// reverse lookup — so the floating SearchBox and the itinerary destination
// input behave identically (structured results, French labels, proximity bias).
//
// No User-Agent header: it's a forbidden header in browsers (silently dropped);
// the Origin/Referer already identifies the app to Nominatim. Respect the usage
// policy (≤ 1 req/s) — callers debounce search and reverse is user-paced.

const NOMINATIM = "https://nominatim.openstreetmap.org";

/// Transport-relevant kind of a place, derived from OSM tags — used to auto-set
/// a leg's mode (two stations → train, two airports → flight).
export type PlaceKind = "station" | "airport" | null;

export interface PlaceResult {
  placeId: number;
  lat: number;
  lon: number;
  /// Short primary label (e.g. "Tour Eiffel", "12 Rue de Rivoli").
  name: string;
  /// Secondary line — the rest of the address for disambiguation.
  detail: string;
  /// OSM category/type, usable for an icon ("city", "restaurant"…).
  category?: string;
  type?: string;
  /// Transport kind (train station / airport) when detectable.
  kind: PlaceKind;
}

/// Classifies an OSM (class, type) pair as a train station, an airport, or
/// neither. Best-effort — relies on how the feature is tagged in OSM.
export function placeKind(category?: string, type?: string): PlaceKind {
  const c = (category ?? "").toLowerCase();
  const t = (type ?? "").toLowerCase();
  if (c === "aeroway" || t === "aerodrome" || t === "airport" || t === "terminal") return "airport";
  if (c === "railway" && (t === "station" || t === "halt")) return "station";
  if (t === "station" && c !== "amenity") return "station";
  if (t === "train_station") return "station";
  return null;
}

/// Mode to auto-assign to the leg between two places of matching transport kind,
/// or null to keep the inherited mode. Returned as the LegMode string literal.
export function autoLegMode(prev: PlaceKind, next: PlaceKind): "train" | "flight" | null {
  if (!prev || prev !== next) return null;
  return prev === "station" ? "train" : "flight";
}

interface SearchOptions {
  signal?: AbortSignal;
  /// Bias results toward this point (nearby matches rank first) without
  /// excluding far ones.
  near?: { lat: number; lon: number };
  limit?: number;
}

/// Builds a short, human label from a Nominatim address object — the most
/// specific meaningful component rather than the full comma-joined string.
function shortLabel(display: string, address?: Record<string, string>): { name: string; detail: string } {
  const parts = display.split(",").map((p) => p.trim());
  const a = address ?? {};
  const specific =
    a.amenity ||
    a.shop ||
    a.tourism ||
    a.leisure ||
    a.building ||
    [a.house_number, a.road].filter(Boolean).join(" ").trim() ||
    a.neighbourhood ||
    a.suburb ||
    a.village ||
    a.town ||
    a.city ||
    parts[0];
  // Detail = the address minus the primary token, trimmed of redundancy.
  const detailParts = parts.filter((p) => p && p !== specific);
  return { name: specific || parts[0] || display, detail: detailParts.join(", ") };
}

export async function searchPlaces(query: string, opts: SearchOptions = {}): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    format: "json",
    q: query,
    limit: String(opts.limit ?? 8),
    addressdetails: "1",
    "accept-language": "fr",
  });
  if (opts.near) {
    // ~0.6° box around the reference point; unbounded so distant results still
    // appear, but Nominatim prefers in-box matches.
    const { lat, lon } = opts.near;
    const d = 0.6;
    params.set("viewbox", `${lon - d},${lat - d},${lon + d},${lat + d}`);
  }
  const res = await fetch(`${NOMINATIM}/search?${params.toString()}`, { signal: opts.signal });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((r: any): PlaceResult => {
    const { name, detail } = shortLabel(r.display_name, r.address);
    return {
      placeId: r.place_id,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      name,
      detail,
      category: r.class,
      type: r.type,
      kind: placeKind(r.class, r.type),
    };
  });
}

/// Returns a short human label for the place nearest to a coordinate, or null
/// if nothing is found / the request fails.
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({
    format: "json",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "fr",
  });
  try {
    const res = await fetch(`${NOMINATIM}/reverse?${params.toString()}`, { signal });
    const data = await res.json();
    if (!data || data.error || !data.display_name) return null;
    return shortLabel(data.display_name, data.address).name;
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    return null;
  }
}

/// Reverse lookup that also returns the place's transport kind — used when a
/// map click / manual coordinate may land on a station or airport.
export async function reverseGeocodeDetailed(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<{ name: string; kind: PlaceKind } | null> {
  const params = new URLSearchParams({
    format: "json",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "fr",
  });
  try {
    const res = await fetch(`${NOMINATIM}/reverse?${params.toString()}`, { signal });
    const data = await res.json();
    if (!data || data.error || !data.display_name) return null;
    return { name: shortLabel(data.display_name, data.address).name, kind: placeKind(data.class, data.type) };
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    return null;
  }
}
