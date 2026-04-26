import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet + Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function MapView({ onMapClick, selectedPos, onPlayRoute, onPlayOsrmRoute }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerInstance = useRef(null);

  useEffect(() => {
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([46.8, 8.2], 6);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance.current);

      mapInstance.current.on('click', (e) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      });
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mapInstance.current && selectedPos) {
      const { lat, lon } = selectedPos;
      
      if (!markerInstance.current) {
        markerInstance.current = L.marker([lat, lon], { draggable: true }).addTo(mapInstance.current);
        
        // Popup avec boutons de navigation
        const popupContent = document.createElement('div');
        popupContent.innerHTML = `
          <div style="padding: 8px; text-align: center; display: flex; flex-direction: column; gap: 8px;">
            <button id="nav-here-btn" style="background: #6366f1; color: white; border: none; padding: 8px 12px; borderRadius: 8px; cursor: pointer; font-weight: bold;">
              🚶 Marcher (Ligne)
            </button>
            <button id="nav-osrm-btn" style="background: #10b981; color: white; border: none; padding: 8px 12px; borderRadius: 8px; cursor: pointer; font-weight: bold;">
              🚗 Conduire (Route)
            </button>
          </div>
        `;
        
        markerInstance.current.bindPopup(popupContent);
        markerInstance.current.on('popupopen', () => {
          document.getElementById('nav-here-btn').onclick = () => {
            onPlayRoute(lat, lon);
            markerInstance.current.closePopup();
          };
          document.getElementById('nav-osrm-btn').onclick = () => {
            onPlayOsrmRoute(lat, lon, 'driving');
            markerInstance.current.closePopup();
          };
        });

        markerInstance.current.on('dragend', (e) => {
          const p = e.target.getLatLng();
          onMapClick(p.lat, p.lng);
        });
      } else {
        markerInstance.current.setLatLng([lat, lon]);
      }
      
      mapInstance.current.setView([lat, lon], mapInstance.current.getZoom());
    }
  }, [selectedPos]);

  return <div ref={mapRef} className="w-full h-full" />;
}

export default MapView;
