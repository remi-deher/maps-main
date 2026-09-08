// Command headless runs the engine without a UI (server / Docker / system
// service). Configuration comes from flags, with environment variables
// (GPSMOCK_*) as defaults so it can be driven by a service env file.
//
// On Windows, when started by the Service Control Manager, it runs as a real
// Windows service; otherwise it runs interactively until SIGINT/SIGTERM.
//
// main() here is deliberately thin: it does the I/O (create the data dir, open
// the SQLite stores, install signal handlers) and delegates every decision to
// resolveRunConfig in config.go, which is a pure function and therefore
// testable.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/remi-deher/maps-main/engine/internal/auth"
	"github.com/remi-deher/maps-main/engine/internal/platform"
	"github.com/remi-deher/maps-main/engine/internal/settings"

	// Register the driver backends.
	_ "github.com/remi-deher/maps-main/engine/internal/driver/goios"
	_ "github.com/remi-deher/maps-main/engine/internal/driver/pmd3"
)

func main() {
	dataDir := envOr(os.Getenv, "GPSMOCK_DATA_DIR", defaultDataDir())
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("settings: cannot create data dir %q: %v", dataDir, err)
	}
	dbPath := filepath.Join(dataDir, "gpsmock.db")
	store, err := settings.OpenStore(dbPath)
	if err != nil {
		log.Fatalf("settings store: %v", err)
	}
	// Remote-access credentials (TOTP pairing seed + paired devices) live in
	// their own tables in the same DB file, kept out of the client-facing
	// settings blob. A failure here is non-fatal: the engine still runs for
	// loopback and API-key callers, just without QR pairing.
	authStore, err := auth.OpenStore(dbPath)
	if err != nil {
		log.Printf("auth store: %v (remote pairing disabled)", err)
	}
	def, err := store.Load()
	if err != nil {
		log.Printf("settings: %v (using defaults)", err)
		def = settings.Default()
	}
	var secrets settings.Secrets
	var secretStore settings.SecretStore
	if s, ok := store.(settings.SecretStore); ok {
		secretStore = s
		secrets, err = secretStore.LoadSecrets()
		if err != nil {
			log.Printf("secrets: %v (using environment/default empty secrets)", err)
		}
	}

	cfg, err := resolveRunConfig(os.Args[1:], os.Getenv, def, os.Stderr)
	if err != nil {
		// flag.ContinueOnError has already printed the problem and the usage.
		os.Exit(2)
	}

	// In the self-contained Windows portable build, extract the embedded
	// drivers on first launch and use them unless the user pointed us
	// elsewhere. A no-op (empty paths) in every other build.
	if cfg.goiosBin == "" || cfg.pythonBin == "" {
		bundledGoios, bundledPython := platform.BundledDriverPaths()
		applyBundledDriverPaths(&cfg, bundledGoios, bundledPython)
	}

	cfg.settingsCfg = def
	cfg.secrets = secrets
	cfg.store = store
	cfg.secretStore = secretStore
	cfg.authStore = authStore

	// Windows service mode: when launched by the SCM, run under the service
	// control protocol instead of waiting on OS signals.
	if isWindowsService() {
		if err := runService(cfg); err != nil {
			log.Fatalf("service: %v", err)
		}
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := runEngine(ctx, cfg); err != nil {
		log.Fatalf("engine: %v", err)
	}
}
