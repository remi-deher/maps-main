import React, { useRef } from "react";
import { Star, Save, Plus, Trash, Activity } from "lucide-react";
import { useWebSocket } from "../../context/websocket";

interface FavoritesTabProps {
  showToast: (message: string) => void;
}

/// Favorites + recent-history content, rendered inside FavoritesModal. Owns
/// its own import/export logic; engine data comes straight from the
/// WebSocket context.
export const FavoritesTab: React.FC<FavoritesTabProps> = ({ showToast }) => {
  const { status, addFavorite, removeFavorite, setLocation } = useWebSocket();
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleExportFavorites = () => {
    const payload = {
      favorites: status?.favorites || [],
      recentHistory: status?.recentHistory || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gps-mock-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Favoris exportés.");
  };

  const handleImportFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const favorites = Array.isArray(parsed.favorites) ? parsed.favorites : Array.isArray(parsed) ? parsed : [];
        if (favorites.length === 0) {
          showToast("Aucun favori trouvé dans ce fichier.");
          return;
        }
        favorites.forEach((fav: any) => {
          if (typeof fav.lat === "number" && typeof fav.lon === "number") {
            addFavorite(fav.lat, fav.lon, fav.name || "Favori importé");
          }
        });
        showToast(`${favorites.length} favori(s) importé(s).`);
      } catch {
        showToast("Fichier invalide.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="ui-card">
        <h3 className="ui-card-title">
          <Star size={16} /> Lieux Favoris
        </h3>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button className="btn btn-secondary" onClick={handleExportFavorites}>
            <Save size={14} /> Exporter
          </button>
          <button className="btn btn-secondary" onClick={() => importFileInputRef.current?.click()}>
            <Plus size={14} /> Importer
          </button>
          <input
            ref={importFileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={handleImportFileSelected}
          />
        </div>
        <div className="list-container">
          {status?.favorites && status.favorites.length > 0 ? (
            status.favorites.map((fav, i) => (
              <div className="list-item" key={i}>
                <button
                  type="button"
                  className="list-item-info"
                  onClick={() => setLocation(fav.lat, fav.lon, fav.name)}
                  aria-label={`Téléporter vers ${fav.name}`}
                >
                  <span className="list-item-name">{fav.name}</span>
                  <span className="list-item-coords">
                    {fav.lat.toFixed(5)}, {fav.lon.toFixed(5)}
                  </span>
                </button>
                <div className="list-item-actions">
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (window.confirm(`Supprimer le favori "${fav.name}" ?`)) {
                        removeFavorite(fav.lat, fav.lon);
                      }
                    }}
                    aria-label={`Supprimer le favori ${fav.name}`}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Star size={22} className="empty-state-icon" />
              <span>Aucun favori enregistré.</span>
              <span className="empty-state-hint">Cliquez sur la carte puis « Favoris » pour en ajouter un.</span>
            </div>
          )}
        </div>
      </div>

      <div className="ui-card">
        <h3 className="ui-card-title">
          <Activity size={16} /> Historique Récent
        </h3>
        <div className="list-container">
          {status?.recentHistory && status.recentHistory.length > 0 ? (
            status.recentHistory.map((item, i) => (
              <div className="list-item" key={i}>
                <button
                  type="button"
                  className="list-item-info"
                  onClick={() => setLocation(item.lat, item.lon, item.name)}
                  aria-label={`Téléporter vers ${item.name || "Lieu Injecté"}`}
                >
                  <span className="list-item-name">{item.name || "Lieu Injecté"}</span>
                  <span className="list-item-coords">
                    {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                  </span>
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Activity size={22} className="empty-state-icon" />
              <span>Aucun historique récent.</span>
              <span className="empty-state-hint">Les téléportations et trajets récents apparaîtront ici.</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
