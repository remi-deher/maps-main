// Package auth persists the remote-access credentials for the engine: a single
// long-lived TOTP seed (used to show a rotating 6-digit pairing code) and a set
// of paired devices, each holding the SHA-256 hash of a durable token.
//
// The flow it backs:
//   - The desktop UI shows a code derived from the seed (rotates every 30s).
//   - A remote client POSTs that code once to /api/pair; on success it receives
//     a durable "<deviceID>.<secret>" token and is recorded here.
//   - Every later connection authenticates with that token (hash compared
//     here), so the client never re-pairs across engine restarts.
//
// Storage lives in the same SQLite file as settings but in its own tables, so
// the secrets never ride along in the client-facing settings blob. Tokens are
// stored hashed: a stolen DB yields no usable credential.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go driver, no CGO required
)

// ErrInvalidToken is returned by VerifyToken's error-free bool path; callers
// that need a sentinel for "unknown/!ok" use it via Revoke on a missing id.
var ErrInvalidToken = errors.New("invalid or unknown device token")

// Device is a paired client as exposed to the management UI (never includes the
// token or its hash).
type Device struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
}

// Store owns the auth tables on top of a SQLite handle.
type Store struct {
	db *sql.DB
}

// OpenStore opens (creating if needed) the auth tables in the SQLite file at
// path — the same file used by settings.OpenStore. A busy_timeout is set so the
// two independent handles don't return SQLITE_BUSY when they happen to write at
// the same moment. On first open it generates and persists the TOTP seed.
func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open auth db: %w", err)
	}
	const schema = `
CREATE TABLE IF NOT EXISTS auth_totp (
	id   INTEGER PRIMARY KEY CHECK (id = 1),
	seed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paired_devices (
	id         TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL,
	label      TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	last_seen  INTEGER NOT NULL DEFAULT 0
);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init auth db: %w", err)
	}
	s := &Store{db: db}
	if _, err := s.ensureSeed(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error { return s.db.Close() }

// ensureSeed returns the persisted TOTP seed, generating and storing a fresh
// one the first time. The seed is 20 random bytes (160 bits, the SHA-1 block
// size RFC 6238 recommends) encoded as base32.
func (s *Store) ensureSeed() (string, error) {
	var seed string
	err := s.db.QueryRow(`SELECT seed FROM auth_totp WHERE id = 1`).Scan(&seed)
	if err == nil {
		return seed, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("read totp seed: %w", err)
	}
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate totp seed: %w", err)
	}
	seed = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	if _, err := s.db.Exec(`INSERT INTO auth_totp (id, seed) VALUES (1, ?)`, seed); err != nil {
		return "", fmt.Errorf("store totp seed: %w", err)
	}
	return seed, nil
}

// CurrentCode returns the 6-digit pairing code valid at time t. The desktop UI
// fetches this over loopback to render the code and the QR.
func (s *Store) CurrentCode(t time.Time) (string, error) {
	seed, err := s.ensureSeed()
	if err != nil {
		return "", err
	}
	return codeAt(seed, t)
}

// VerifyCode reports whether code is the valid pairing code at time t (±1 step).
func (s *Store) VerifyCode(code string, t time.Time) bool {
	seed, err := s.ensureSeed()
	if err != nil {
		return false
	}
	return verifyCodeAt(seed, code, t)
}

// RegenerateSeed replaces the TOTP seed, invalidating any in-flight pairing
// code without touching already-paired devices.
func (s *Store) RegenerateSeed() error {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("generate totp seed: %w", err)
	}
	seed := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	_, err := s.db.Exec(`
INSERT INTO auth_totp (id, seed) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET seed = excluded.seed`, seed)
	if err != nil {
		return fmt.Errorf("rotate totp seed: %w", err)
	}
	return nil
}

// Pair records a new device and returns its durable bearer token in the form
// "<deviceID>.<secret>". Only the SHA-256 hash of the secret is stored, so the
// plaintext returned here is the only copy — the client must keep it. label is
// a human description for the revocation UI ("iPhone de Rémi").
func (s *Store) Pair(label string) (token string, dev Device, err error) {
	id := uuid.NewString()
	secretRaw := make([]byte, 32)
	if _, err = rand.Read(secretRaw); err != nil {
		return "", Device{}, fmt.Errorf("generate device secret: %w", err)
	}
	secret := base64.RawURLEncoding.EncodeToString(secretRaw)
	now := time.Now().Unix()
	if _, err = s.db.Exec(
		`INSERT INTO paired_devices (id, token_hash, label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
		id, hashSecret(secret), strings.TrimSpace(label), now, now,
	); err != nil {
		return "", Device{}, fmt.Errorf("store paired device: %w", err)
	}
	return id + "." + secret, Device{ID: id, Label: strings.TrimSpace(label), CreatedAt: now, LastSeen: now}, nil
}

// VerifyToken reports whether token ("<deviceID>.<secret>") matches a paired
// device. On success it refreshes the device's last_seen. The hash comparison
// is constant-time.
func (s *Store) VerifyToken(token string) bool {
	id, secret, ok := strings.Cut(token, ".")
	if !ok || id == "" || secret == "" {
		return false
	}
	var storedHash string
	if err := s.db.QueryRow(`SELECT token_hash FROM paired_devices WHERE id = ?`, id).Scan(&storedHash); err != nil {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(storedHash), []byte(hashSecret(secret))) != 1 {
		return false
	}
	_, _ = s.db.Exec(`UPDATE paired_devices SET last_seen = ? WHERE id = ?`, time.Now().Unix(), id)
	return true
}

// ListDevices returns all paired devices, newest first, for the management UI.
func (s *Store) ListDevices() ([]Device, error) {
	rows, err := s.db.Query(`SELECT id, label, created_at, last_seen FROM paired_devices ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Label, &d.CreatedAt, &d.LastSeen); err != nil {
			return nil, fmt.Errorf("scan device: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Revoke removes one paired device; that client must re-pair to reconnect.
func (s *Store) Revoke(id string) error {
	res, err := s.db.Exec(`DELETE FROM paired_devices WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("revoke device: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvalidToken
	}
	return nil
}

// hashSecret returns the hex-encoded SHA-256 of a device secret. SHA-256 (not a
// slow KDF) is adequate here because the secret is 256 bits of CSPRNG output —
// there is no low-entropy password to brute-force.
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
