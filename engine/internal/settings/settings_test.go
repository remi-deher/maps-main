package settings

import (
	"path/filepath"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestDefault(t *testing.T) {
	def := Default()

	if def.CompanionPort != 8080 {
		t.Errorf("expected default companion port 8080, got %d", def.CompanionPort)
	}

	if def.PreferredDriver != domain.DriverGoIos {
		t.Errorf("expected preferred driver go-ios, got %s", def.PreferredDriver)
	}

	if def.UsbDriver != domain.DriverGoIos {
		t.Errorf("expected usb driver go-ios, got %s", def.UsbDriver)
	}

	if def.WifiDriver != domain.DriverGoIos {
		t.Errorf("expected wifi driver go-ios, got %s", def.WifiDriver)
	}

	if !def.EveilMode {
		t.Errorf("expected EveilMode to be true by default")
	}

	if def.EveilInterval != 5 {
		t.Errorf("expected EveilInterval to be 5, got %d", def.EveilInterval)
	}

	if !def.FallbackEnabled {
		t.Errorf("expected FallbackEnabled to be true by default")
	}

	if !def.NotificationsEnabled {
		t.Errorf("expected NotificationsEnabled to be true by default")
	}

	if !def.DynamicIslandEnabled {
		t.Errorf("expected DynamicIslandEnabled to be true by default")
	}

	if !def.JitterEnabled {
		t.Errorf("expected JitterEnabled to be true by default")
	}
}

func TestSQLStore(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_settings.db")

	store, err := OpenStore(dbPath)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer func() {
		if s, ok := store.(*sqlStore); ok {
			_ = s.Close()
		}
	}()

	// Load initial settings (should be Default)
	cfg, err := store.Load()
	if err != nil {
		t.Fatalf("failed to load settings: %v", err)
	}
	if cfg.CompanionPort != 8080 {
		t.Errorf("expected default companion port 8080, got %d", cfg.CompanionPort)
	}

	// Save modified settings
	cfg.CompanionPort = 9000
	cfg.LogLevel = "debug"
	err = store.Save(cfg)
	if err != nil {
		t.Fatalf("failed to save settings: %v", err)
	}

	// Load again and verify
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("failed to load settings after save: %v", err)
	}
	if loaded.CompanionPort != 9000 {
		t.Errorf("expected companion port 9000, got %d", loaded.CompanionPort)
	}
	if loaded.LogLevel != "debug" {
		t.Errorf("expected LogLevel 'debug', got %s", loaded.LogLevel)
	}

	s, ok := store.(*sqlStore)
	if !ok {
		t.Fatalf("expected store to be *sqlStore")
	}

	// Write invalid JSON directly into database to test decode settings error fallback
	_, err = s.db.Exec(`UPDATE settings SET data = 'invalid-json' WHERE id = 1`)
	if err != nil {
		t.Fatalf("failed to update db with invalid json: %v", err)
	}

	fallback, err := store.Load()
	if err == nil {
		t.Errorf("expected error when loading invalid JSON, got nil")
	}
	if fallback.CompanionPort != 8080 {
		t.Errorf("expected fallback companion port 8080, got %d", fallback.CompanionPort)
	}
}
