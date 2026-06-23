package settings

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite" // pure-Go driver, no CGO required
)

// Store is the interface that groups Load and Save methods for configurations.
type Store interface {
	Load() (Settings, error)
	Save(Settings) error
}

// sqlStore persists Settings to a local SQLite database so configuration
// edited from the web/companion UI survives an engine restart.
type sqlStore struct {
	db *sql.DB
}

// OpenStore opens (creating if needed) the SQLite database at path and
// ensures the settings table exists.
func OpenStore(path string) (Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open settings db: %w", err)
	}
	db.SetMaxOpenConns(1) // sqlite + a single writer keeps this simple and safe

	const schema = `
CREATE TABLE IF NOT EXISTS settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	data TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init settings db: %w", err)
	}
	return &sqlStore{db: db}, nil
}

// Close releases the underlying database handle.
func (s *sqlStore) Close() error {
	return s.db.Close()
}

// Load returns the persisted settings, or Default() if nothing was saved yet.
func (s *sqlStore) Load() (Settings, error) {
	var data string
	err := s.db.QueryRow(`SELECT data FROM settings WHERE id = 1`).Scan(&data)
	if err == sql.ErrNoRows {
		return Default(), nil
	}
	if err != nil {
		return Default(), fmt.Errorf("load settings: %w", err)
	}
	cfg := Default()
	if err := json.Unmarshal([]byte(data), &cfg); err != nil {
		return Default(), fmt.Errorf("decode settings: %w", err)
	}
	return cfg, nil
}

// Save upserts the full settings snapshot.
func (s *sqlStore) Save(cfg Settings) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	_, err = s.db.Exec(`
INSERT INTO settings (id, data, updated_at) VALUES (1, ?, strftime('%s','now'))
ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		string(data))
	if err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}
