import React, { useState, useEffect, useRef } from "react";
import { Search, MapPin } from "lucide-react";
import { searchPlaces, PlaceResult, PlaceKind } from "../lib/geocoding";

interface DestinationSearchInputProps {
  placeholder: string;
  onSelect: (lat: number, lon: number, name: string, kind?: PlaceKind) => void;
  /// Optional reference point to bias results toward (nearby first).
  near?: { lat: number; lon: number };
}

/// Inline geocoding search field — structured two-line results (name +
/// address), French labels and proximity bias via the shared geocoding lib.
/// Clears itself after a selection so it's ready for the next stop.
export const DestinationSearchInput: React.FC<DestinationSearchInputProps> = ({ placeholder, onSelect, near }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Read `near` from a ref so a moving simulation re-biasing the position
  // doesn't re-fire the search debounce on every tick.
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 3) {
      setResults([]);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      setSearchError(null);
      try {
        const places = await searchPlaces(query, { signal: controller.signal, near: nearRef.current });
        setResults(places);
        setShowDropdown(true);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("Geocoding error:", error);
        setSearchError("Recherche indisponible (réseau).");
        setShowDropdown(true);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(delayDebounce);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (res: PlaceResult) => {
    onSelect(res.lat, res.lon, res.name, res.kind);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
  };

  return (
    <div className="inline-search-container" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 3 && setShowDropdown(true)}
        />
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
                key={res.placeId}
                className="search-result-item"
                role="option"
                aria-selected={false}
                onClick={() => handleSelect(res)}
              >
                <MapPin size={14} className="result-marker-icon" />
                <span className="result-text-block">
                  <span className="result-primary">{res.name}</span>
                  {res.detail && <span className="result-secondary">{res.detail}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
