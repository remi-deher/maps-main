import { useState } from 'react';

export function useSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async (query) => {
    if (!query || query.length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`);
      const data = await response.json();
      setResults(data.map(item => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon)
      })));
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setLoading(false);
    }
  };

  const reverseGeocode = async (lat, lon) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`);
      const d = await r.json();
      if (!d.address) return d.display_name?.split(',').slice(0, 2).join(',').trim() || null;
      const addr = d.address;
      const main = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || addr.city_district || '';
      const city = addr.city || addr.town || addr.village || '';
      if (main && city) return `${main}, ${city}`;
      return d.display_name?.split(',').slice(0, 2).join(',').trim() || null;
    } catch {
      return null;
    }
  };

  return { search, results, loading, reverseGeocode, setResults };
}
