import React, { useState, useEffect, useRef } from "react";
import { Search, MapPin, X } from "lucide-react";
import { searchPlaces, PlaceResult } from "../lib/geocoding";

interface SearchBoxProps {
  onSelectLocation: (lat: number, lon: number, name: string) => void;
  /// Optional reference point to bias results toward (nearby first).
  near?: { lat: number; lon: number };
}

export const SearchBox: React.FC<SearchBoxProps> = ({ onSelectLocation, near }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  // Read `near` from a ref so a moving simulation re-biasing the position
  // doesn't re-fire the search debounce on every tick.
  const nearRef = useRef(near);
  nearRef.current = near;

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
        const places = await searchPlaces(query, { signal: controller.signal, near: nearRef.current });
        setResults(places);
        setActiveIndex(-1);
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
    onSelectLocation(res.lat, res.lon, res.name);
    setQuery(res.name);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex >= 0 ? activeIndex : 0];
      if (target) handleSelect(target);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
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
          onKeyDown={handleKeyDown}
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
            results.map((res, idx) => (
              <button
                type="button"
                key={res.placeId}
                className={`search-result-item${idx === activeIndex ? " active" : ""}`}
                role="option"
                aria-selected={idx === activeIndex}
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
