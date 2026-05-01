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

function MapView({ onMapClick, selectedPos, onPlayRoute, onPlayOsrmRoute, routePreview, onSequencePointMove }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerInstance = useRef(null);
  const routeLayerInstance = useRef(null);
  const previewMarkersInstance = useRef([]);
  
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([46.8, 8.2], 6);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance.current);

      mapInstance.current.on('click', (e) => {
        if (onMapClickRef.current) {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
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
          if (onMapClickRef.current) onMapClickRef.current(p.lat, p.lng);
        });
      } else {
        markerInstance.current.setLatLng([lat, lon]);
      }
      
      mapInstance.current.setView([lat, lon], mapInstance.current.getZoom());
    }
  }, [selectedPos]);

  useEffect(() => {
    if (!mapInstance.current) return;

    // Nettoyage de la prévisualisation précédente
    if (routeLayerInstance.current) {
      mapInstance.current.removeLayer(routeLayerInstance.current);
      routeLayerInstance.current = null;
    }
    previewMarkersInstance.current.forEach(m => mapInstance.current.removeLayer(m));
    previewMarkersInstance.current = [];

    if (routePreview && routePreview.length > 0) {
      const latlngs = routePreview.map(p => [p.lat, p.lon]);
      
      // Ligne de l'itinéraire
      if (latlngs.length > 1) {
        routeLayerInstance.current = L.polyline(latlngs, {
          color: '#6366f1',
          weight: 4,
          opacity: 0.6,
          dashArray: '10, 10'
        }).addTo(mapInstance.current);
      }

      // Points d'étapes (utilisant des marqueurs draggables)
      routePreview.forEach((p, i) => {
        const isStart = i === 0;
        const isEnd = i === routePreview.length - 1;
        const color = isStart ? '#6366f1' : (isEnd ? '#f43f5e' : '#10b981');
        
        const icon = L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="background-color: ${color}; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 5px rgba(0,0,0,0.3);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });

        const m = L.marker([p.lat, p.lon], { 
          icon, 
          draggable: true,
          title: isStart ? 'Départ' : (isEnd ? 'Destination' : `Étape ${i}`)
        }).addTo(mapInstance.current);
        
        m.on('dragend', (e) => {
          const newPos = e.target.getLatLng();
          if (onSequencePointMove) {
            onSequencePointMove(p.id, newPos.lat, newPos.lng);
          }
        });

        previewMarkersInstance.current.push(m);
      });

      // Labels entre les étapes
      for (let i = 1; i < routePreview.length; i++) {
        const p1 = routePreview[i-1];
        const p2 = routePreview[i];
        
        const mid = [(p1.lat + p2.lat) / 2, (p1.lon + p2.lon) / 2];
        const dist = L.latLng(p1.lat, p1.lon).distanceTo(L.latLng(p2.lat, p2.lon));
        const duration = p2.duration || 0;
        
        const formatTime = (s) => {
          if (s < 60) return `${s}s`;
          const m = Math.floor(s / 60);
          if (m < 60) return `${m}m`;
          return `${Math.floor(m / 60)}h${m % 60}m`;
        };

        const labelHtml = `
          <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 6px; color: white; font-size: 9px; font-weight: 800; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 4px;">
            <span style="color: #818cf8;">${dist < 1000 ? dist.toFixed(0)+'m' : (dist/1000).toFixed(1)+'km'}</span>
            <span style="color: rgba(255,255,255,0.3);">|</span>
            <span style="color: #fbbf24;">${formatTime(duration)}</span>
          </div>
        `;

        const label = L.marker(mid, {
          icon: L.divIcon({
            className: 'segment-label',
            html: labelHtml,
            iconSize: [80, 20],
            iconAnchor: [40, 10]
          }),
          interactive: false
        }).addTo(mapInstance.current);

        previewMarkersInstance.current.push(label);
      }

      // Si c'est le premier rendu de la séquence ou un changement majeur, on zoom
      // (Optionnel : on peut éviter de zoomer à chaque drag pour ne pas perdre le focus)
    }
  }, [routePreview]);

  return <div ref={mapRef} className="w-full h-full" />;
}

export default MapView;
