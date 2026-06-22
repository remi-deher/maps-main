package engine

import (
	"context"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// findFavoriteIndex returns the index of the favorite at (lat, lon) in favs,
// or -1 if none matches. Shared by AddFavorite/RemoveFavorite/RenameFavorite.
// Caller must hold e.mu.
func findFavoriteIndex(favs []domain.Favorite, lat, lon float64) int {
	for i, f := range favs {
		if f.Lat == lat && f.Lon == lon {
			return i
		}
	}
	return -1
}

// AddFavorite adds a new favorite location
func (e *Engine) AddFavorite(ctx context.Context, lat, lon float64, name string) error {
	e.mu.Lock()
	if findFavoriteIndex(e.st.Favorites, lat, lon) >= 0 {
		e.mu.Unlock()
		return nil
	}
	e.st.Favorites = append(e.st.Favorites, domain.Favorite{
		Lat:       lat,
		Lon:       lon,
		Name:      name,
		Timestamp: time.Now().UnixMilli(),
	})
	e.emitStatusLocked()
	e.persist()
	return nil
}

// RemoveFavorite deletes a favorite location
func (e *Engine) RemoveFavorite(ctx context.Context, lat, lon float64) error {
	e.mu.Lock()
	var updated []domain.Favorite
	for _, f := range e.st.Favorites {
		if f.Lat == lat && f.Lon == lon {
			continue
		}
		updated = append(updated, f)
	}
	e.st.Favorites = updated
	e.emitStatusLocked()
	e.persist()
	return nil
}

// RenameFavorite renames a favorite location
func (e *Engine) RenameFavorite(ctx context.Context, lat, lon float64, newName string) error {
	e.mu.Lock()
	if idx := findFavoriteIndex(e.st.Favorites, lat, lon); idx >= 0 {
		e.st.Favorites[idx].Name = newName
	}
	e.emitStatusLocked()
	e.persist()
	return nil
}

// ClearHistory wipes the recent-history list — an admin/housekeeping action,
// distinct from favorites (which the user curates deliberately).
func (e *Engine) ClearHistory(ctx context.Context) error {
	e.mu.Lock()
	e.st.RecentHistory = nil
	e.emitStatusLocked()
	e.persist()
	e.Log("info", "admin", "Historique vidé")
	return nil
}
