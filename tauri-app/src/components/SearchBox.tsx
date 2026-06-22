import React, { useState, useEffect, useRef } from "react";
import { Search, MapPin, X } from "lucide-react";

interface SearchBoxProps {
  onSelectLocation: (lat: number, lon: number, name: string) => void;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export const SearchBox: React.FC<SearchBoxProps> = ({ onSelectLocation }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle clicking outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 3) {
      setResults([]);
      setSearchError(null);
      return;
    }

    // Abort an in-flight request when the query changes or the component
    // unmounts, so stale responses can't overwrite newer results.
    const controller = new AbortController();
    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      setSearchError(null);
      try {
        // No User-Agent header: it's a forbidden header in browsers (silently
        // dropped); the Origin/Referer already identifies the app to Nominatim.
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            query
          )}&limit=5`,
          { signal: controller.signal }
        );
        const data = await response.json();
        setResults(data);
        setShowDropdown(true);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("Geocoding error:", error);
        setSearchError("Recherche indisponible (réseau).");
        setShowDropdown(true);
      } finally {
        setLoading(false);
      }
    }, 600);

    return () => {
      clearTimeout(delayDebounce);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (res: NominatimResult) => {
    const lat = parseFloat(res.lat);
    const lon = parseFloat(res.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      // Extract short name (first part of display_name)
      const shortName = res.display_name.split(",")[0] || "Lieu Recherché";
      onSelectLocation(lat, lon, shortName);
      setQuery(res.display_name);
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setSearchError(null);
  };

  return (
    <div className="search-box-container" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search size={18} className="search-icon" />
        <input
          type="text"
          placeholder="Rechercher un lieu ou une adresse..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 3 && setShowDropdown(true)}
        />
        {query && (
          <button className="clear-search-btn" onClick={handleClear} aria-label="Effacer la recherche">
            <X size={16} />
          </button>
        )}
      </div>

      {showDropdown && (results.length > 0 || loading || searchError) && (
        <div className="search-results-dropdown" role="listbox" aria-label="Résultats de recherche">
          {loading ? (
            <div className="search-dropdown-loading">Recherche en cours...</div>
          ) : searchError ? (
            <div className="search-dropdown-loading" role="alert">{searchError}</div>
          ) : (
            results.map((res) => (
              <button
                type="button"
                key={res.place_id}
                className="search-result-item"
                role="option"
                aria-selected={false}
                onClick={() => handleSelect(res)}
              >
                <MapPin size={14} className="result-marker-icon" />
                <span className="result-text">{res.display_name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
