import React, { useState } from "react";
import { Route, Star, X } from "lucide-react";
import { LatLon } from "../context/websocket";

interface MapActionSheetProps {
  coords: LatLon;
  /// Nearest place name (reverse-geocoded), shown as the sheet title when known.
  placeName?: string | null;
  canSend: boolean;
  favName: string;
  setFavName: (name: string) => void;
  onTeleport: () => void;
  /// Sends this point to the unified Itinéraire builder (map-tool-panel) and
  /// switches to route mode, instead of a cramped inline route form.
  onAddToRoute: () => void;
  onAddFavorite: (e: React.FormEvent) => void;
  onClose: () => void;
}

/// Contextual bottom-sheet shown after clicking a point on the map — replaces
/// the cramped in-popup form, closer to the Google Maps / Apple Plans pattern.
export const MapActionSheet: React.FC<MapActionSheetProps> = ({
  coords,
  placeName,
  canSend,
  favName,
  setFavName,
  onTeleport,
  onAddToRoute,
  onAddFavorite,
  onClose,
}) => {
  const [expanded, setExpanded] = useState<"favorite" | null>(null);

  return (
    <div className="map-action-sheet">
      <div className="map-action-sheet-header">
        <div>
          <strong>{placeName || "Cible choisie"}</strong>
          <div className="map-action-sheet-coords">
            {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <X size={16} />
        </button>
      </div>

      <div className="map-action-sheet-actions">
        <button className="btn btn-success" disabled={!canSend} onClick={onTeleport}>
          Téléporter
        </button>
        <button className="btn btn-secondary" disabled={!canSend} onClick={onAddToRoute}>
          <Route size={14} /> Itinéraire
        </button>
        <button
          className="btn btn-secondary"
          disabled={!canSend}
          onClick={() => setExpanded(expanded === "favorite" ? null : "favorite")}
        >
          <Star size={14} /> Favoris
        </button>
      </div>

      {expanded === "favorite" && (
        <form className="map-action-sheet-expand" onSubmit={onAddFavorite}>
          <input
            type="text"
            value={favName}
            onChange={(e) => setFavName(e.target.value)}
            placeholder="Nom du favori..."
            aria-label="Nom du favori"
            required
          />
          <button type="submit" className="btn btn-secondary" disabled={!canSend}>
            Ajouter
          </button>
        </form>
      )}
    </div>
  );
};
