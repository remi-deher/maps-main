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

// Secrets is persisted separately from Settings so sensitive server-only values
// never ride in the client-facing settings snapshot.
type Secrets struct {
	GoogleRoutesAPIKey string
	MapboxAccessToken  string
}

// SecretStore groups secret load/save operations. sqlStore implements both
// Store and SecretStore against the same SQLite database.
type SecretStore interface {
	LoadSecrets() (Secrets, error)
	SaveSecrets(Secrets) error
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
);
CREATE TABLE IF NOT EXISTS secrets (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init settings db: %w", err)
	}
	return &sqlStore{db: db}, nil
}

// LoadSecrets returns server-only secrets. Missing keys are simply empty.
func (s *sqlStore) LoadSecrets() (Secrets, error) {
	rows, err := s.db.Query(`SELECT key, value FROM secrets WHERE key IN ('googleRoutesApiKey', 'mapboxAccessToken')`)
	if err != nil {
		return Secrets{}, fmt.Errorf("load secrets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var secrets Secrets
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return Secrets{}, fmt.Errorf("scan secret: %w", err)
		}
		switch key {
		case "googleRoutesApiKey":
			secrets.GoogleRoutesAPIKey = value
		case "mapboxAccessToken":
			secrets.MapboxAccessToken = value
		}
	}
	if err := rows.Err(); err != nil {
		return Secrets{}, fmt.Errorf("iterate secrets: %w", err)
	}
	return secrets, nil
}

// SaveSecrets upserts the full secret snapshot. Empty values delete the key,
// which gives the UI an explicit "clear secret" operation.
func (s *sqlStore) SaveSecrets(secrets Secrets) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin save secrets: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := saveSecret(tx, "googleRoutesApiKey", secrets.GoogleRoutesAPIKey); err != nil {
		return err
	}
	if err := saveSecret(tx, "mapboxAccessToken", secrets.MapboxAccessToken); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit save secrets: %w", err)
	}
	return nil
}

func saveSecret(tx *sql.Tx, key, value string) error {
	if value == "" {
		if _, err := tx.Exec(`DELETE FROM secrets WHERE key = ?`, key); err != nil {
			return fmt.Errorf("delete secret %s: %w", key, err)
		}
		return nil
	}
	_, err := tx.Exec(`
INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value)
	if err != nil {
		return fmt.Errorf("save secret %s: %w", key, err)
	}
	return nil
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
