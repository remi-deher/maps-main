import React, { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { Minus, Plus } from "lucide-react";
import type { LatLon } from "../../types/engine";

// The Leaflet-context helpers: components that exist only to call useMap() and
// wire the map to something outside it — a keyboard shortcut, a window event, a
// resize observer. They carry no application state, which is why they live here
// rather than in MapContainer: the map component should be about what is drawn,
// not about how Leaflet is driven.

// Zoom buttons rendered inside the Leaflet context so useMap() is available.
export const ZoomControls: React.FC = () => {
  const map = useMap();
  return (
    <div className="map-zoom-controls" role="group" aria-label="Zoom">
      <button
        className="map-zoom-btn"
        onClick={() => map.zoomIn()}
        title="Zoom avant (+)"
        aria-label="Zoom avant"
      >
        <Plus size={18} />
      </button>
      <button
        className="map-zoom-btn"
        onClick={() => map.zoomOut()}
        title="Zoom arrière (-)"
        aria-label="Zoom arrière"
      >
        <Minus size={18} />
      </button>
    </div>
  );
};

// Keyboard zoom: +/= to zoom in, - to zoom out. Ignored while typing, so the
// shortcut can't fire from inside the search box or a settings field.
export const KeyboardZoomHandler: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") map.zoomIn();
      if (e.key === "-") map.zoomOut();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [map]);
  return null;
};

// Pans/zooms the map to a location when the "fly-to-search" custom event fires.
export const FlyToSearch: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const handler = (e: Event) => {
      const { lat, lon } = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      map.setView([lat, lon], Math.max(map.getZoom(), 14));
    };
    window.addEventListener("fly-to-search", handler);
    return () => window.removeEventListener("fly-to-search", handler);
  }, [map]);
  return null;
};

// Centers the map on the simulated position and keeps following it — until the
// user drags the map themselves, at which point following stops so the view
// doesn't fight them. The "recenter-map" event resumes it.
export const RecenterMap: React.FC<{ coords: LatLon }> = ({ coords }) => {
  const map = useMap();
  const hasCentered = useRef(false);
  const isFollowing = useRef(true);

  useEffect(() => {
    const handleDragStart = () => {
      isFollowing.current = false;
    };
    map.on("dragstart", handleDragStart);
    return () => {
      map.off("dragstart", handleDragStart);
    };
  }, [map]);

  useEffect(() => {
    // (0, 0) is the "no position yet" placeholder, not a real fix in the Gulf
    // of Guinea — panning there would yank the view off whatever the user was
    // looking at.
    if (!coords || (coords.lat === 0 && coords.lon === 0)) return;

    if (!hasCentered.current) {
      map.setView([coords.lat, coords.lon], 13);
      hasCentered.current = true;
    } else if (isFollowing.current) {
      map.panTo([coords.lat, coords.lon]);
    }
  }, [coords, map]);

  useEffect(() => {
    const handleRecenter = () => {
      if (coords && coords.lat !== 0 && coords.lon !== 0) {
        isFollowing.current = true;
        map.panTo([coords.lat, coords.lon]);
      }
    };
    window.addEventListener("recenter-map", handleRecenter);
    return () => {
      window.removeEventListener("recenter-map", handleRecenter);
    };
  }, [coords, map]);

  return null;
};

// Keeps Leaflet's internal size in sync with its container (panel collapse or
// expand, window resize) — without it the map renders mis-sized and offset.
export const MapResizeHandler: React.FC = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
};

export const MapEventsHandler: React.FC<{ onMapClick: (coords: LatLon) => void }> = ({ onMapClick }) => {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
};
