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

function MapView({ 
  onMapClick, selectedPos, activeSim, onPlayRoute, onPlayOsrmRoute, 
  routePreview, onSequencePointMove, patrolZone, onPatrolChange, favorites 
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerInstance = useRef(null);
  const routeLayerInstance = useRef(null);
  const previewMarkersInstance = useRef([]);
  const patrolLayerInstance = useRef(null);
  const patrolHandlesInstance = useRef([]);
  const favoritesLayerInstance = useRef(L.layerGroup());
  
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

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapInstance.current);

      favoritesLayerInstance.current.addTo(mapInstance.current);

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
    } else if (mapInstance.current && !selectedPos && markerInstance.current) {
      mapInstance.current.removeLayer(markerInstance.current);
      markerInstance.current = null;
    }
  }, [selectedPos]);

  const lastSimPos = useRef(null);
  const simMarkerInstance = useRef(null);

  useEffect(() => {
    if (mapInstance.current && activeSim) {
      const { lat, lon } = activeSim;
      
      let rotation = 0;
      if (lastSimPos.current) {
        const p1 = mapInstance.current.project([lastSimPos.current.lat, lastSimPos.current.lon], mapInstance.current.getZoom());
        const p2 = mapInstance.current.project([lat, lon], mapInstance.current.getZoom());
        if (p1.distanceTo(p2) > 1) {
          rotation = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI + 90;
        } else {
          rotation = lastSimPos.current.rotation || 0;
        }
      }
      lastSimPos.current = { lat, lon, rotation };

      if (!simMarkerInstance.current) {
        simMarkerInstance.current = L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'sim-car-marker',
            html: `<div style="transform: rotate(${rotation}deg); font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🚗</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          }),
          zIndexOffset: 1000
        }).addTo(mapInstance.current);
      } else {
        simMarkerInstance.current.setLatLng([lat, lon]);
        simMarkerInstance.current.setIcon(L.divIcon({
          className: 'sim-car-marker',
          html: `<div style="transform: rotate(${rotation}deg); transition: transform 0.2s linear; font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🚗</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        }));
      }
    } else if (mapInstance.current && !activeSim && simMarkerInstance.current) {
      mapInstance.current.removeLayer(simMarkerInstance.current);
      simMarkerInstance.current = null;
      lastSimPos.current = null;
    }
  }, [activeSim]);

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
      const fullPath = [];
      routePreview.forEach((p, i) => {
        if (i === 0) {
          fullPath.push([p.lat, p.lon]);
        } else {
          if (p.path && p.path.length > 0) {
            p.path.forEach(pt => fullPath.push([pt.lat, pt.lon]));
          } else {
            fullPath.push([p.lat, p.lon]);
          }
        }
      });
      
      // Ligne de l'itinéraire
      if (fullPath.length > 1) {
        routeLayerInstance.current = L.polyline(fullPath, {
          color: '#6366f1',
          weight: 4,
          opacity: 0.8,
          dashArray: null // On met une ligne pleine pour le tracé OSRM
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
  
  // Rendu de la zone de patrouille
  useEffect(() => {
    if (!mapInstance.current) return;

    if (patrolLayerInstance.current) {
      mapInstance.current.removeLayer(patrolLayerInstance.current);
      patrolLayerInstance.current = null;
    }
    patrolHandlesInstance.current.forEach(h => mapInstance.current.removeLayer(h));
    patrolHandlesInstance.current = [];

    if (patrolZone) {
      const { type, center, radius, bounds, active } = patrolZone;
      const color = active ? '#10b981' : '#64748b';
      
      if (type === 'circle') {
        patrolLayerInstance.current = L.circle([center.lat, center.lon], {
          radius: radius || 100,
          color: color,
          dashArray: '5, 10',
          fillOpacity: 0.1,
          weight: 2
        }).addTo(mapInstance.current);

        // Handle pour le centre
        const centerMarker = L.marker([center.lat, center.lon], {
          draggable: true,
          icon: L.divIcon({ className: 'handle', html: '<div style="width:10px;height:10px;background:white;border:2px solid #10b981;border-radius:50%"></div>', iconSize: [10, 10] })
        }).addTo(mapInstance.current);

        centerMarker.on('drag', (e) => {
          const p = e.target.getLatLng();
          onPatrolChange({ ...patrolZone, center: { lat: p.lat, lon: p.lng } });
        });
        patrolHandlesInstance.current.push(centerMarker);

        // Handle pour le rayon (à l'est du cercle)
        const radiusPoint = L.latLng(center.lat, center.lon).toBounds(radius || 100).getNorthEast();
        const radiusMarker = L.marker([center.lat, radiusPoint.lng], {
          draggable: true,
          icon: L.divIcon({ className: 'handle', html: '<div style="width:10px;height:10px;background:white;border:2px solid #10b981;"></div>', iconSize: [10, 10] })
        }).addTo(mapInstance.current);

        radiusMarker.on('drag', (e) => {
          const p = e.target.getLatLng();
          const newRadius = L.latLng(center.lat, center.lon).distanceTo(p);
          onPatrolChange({ ...patrolZone, radius: newRadius });
        });
        patrolHandlesInstance.current.push(radiusMarker);

      } else if (type === 'rectangle' && bounds) {
        patrolLayerInstance.current = L.rectangle([[bounds.sw.lat, bounds.sw.lon], [bounds.ne.lat, bounds.ne.lon]], {
          color: color,
          dashArray: '5, 10',
          fillOpacity: 0.1,
          weight: 2
        }).addTo(mapInstance.current);

        // Handles pour les coins SW et NE
        const createCornerHandle = (key) => {
          const pos = bounds[key];
          const m = L.marker([pos.lat, pos.lon], {
            draggable: true,
            icon: L.divIcon({ className: 'handle', html: '<div style="width:10px;height:10px;background:white;border:2px solid #10b981;"></div>', iconSize: [10, 10] })
          }).addTo(mapInstance.current);

          m.on('drag', (e) => {
            const p = e.target.getLatLng();
            const newBounds = { ...bounds, [key]: { lat: p.lat, lon: p.lng } };
            onPatrolChange({ ...patrolZone, bounds: newBounds });
          });
          patrolHandlesInstance.current.push(m);
        };

        createCornerHandle('sw');
        createCornerHandle('ne');
      }
    }
  }, [patrolZone, onPatrolChange]);
 
  // Rendu des favoris
  useEffect(() => {
    if (!mapInstance.current || !favorites) return;
    favoritesLayerInstance.current.clearLayers();
    favorites.forEach(fav => {
      const icon = L.divIcon({
        className: 'fav-marker',
        html: `<div style="background-color: #fbbf24; width: 10px; height: 10px; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      });
      L.marker([fav.lat, fav.lon], { icon, title: fav.name })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onMapClickRef.current(fav.lat, fav.lon, fav.name);
        })
        .addTo(favoritesLayerInstance.current);
    });
  }, [favorites]);

  return <div ref={mapRef} className="w-full h-full" />;
}

export default MapView;
