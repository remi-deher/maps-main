// Command headless runs the engine without a UI (server / Docker / system
// service). Configuration comes from flags, with environment variables
// (GPSMOCK_*) as defaults so it can be driven by a service env file.
//
// On Windows, when started by the Service Control Manager, it runs as a real
// Windows service; otherwise it runs interactively until SIGINT/SIGTERM.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/auth"
	"github.com/remi-deher/maps-main/engine/internal/platform"
	"github.com/remi-deher/maps-main/engine/internal/settings"

	// Register the driver backends.
	_ "github.com/remi-deher/maps-main/engine/internal/driver/goios"
	_ "github.com/remi-deher/maps-main/engine/internal/driver/pmd3"
)

// defaultDataDir returns ~/.gpsmock (or the equivalent on Windows/macOS) so
// the settings database has a sane home when GPSMOCK_DATA_DIR isn't set.
func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".gpsmock")
	}
	return "."
}

func main() {
	dataDir := envOr("GPSMOCK_DATA_DIR", defaultDataDir())
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

	driverFlag := flag.String("driver", envOr("GPSMOCK_DRIVER", string(def.PreferredDriver)), "tunnel driver: pymobiledevice | go-ios")
	transportFlag := flag.String("transport", envOr("GPSMOCK_TRANSPORT", "auto"), "transport: auto | usb | wifi")
	addrFlag := flag.String("addr", envOr("GPSMOCK_ADDR", fmt.Sprintf(":%d", def.CompanionPort)), "listen address")
	mdnsInterface := flag.String("mdns-interface", os.Getenv("GPSMOCK_MDNS_INTERFACE"), "network interface name to restrict the mDNS advertisement to (default: advertise on every interface)")
	goiosBin := flag.String("goios-bin", os.Getenv("GPSMOCK_GOIOS_BIN"), "explicit path to the go-ios binary")
	pythonBin := flag.String("python-bin", os.Getenv("GPSMOCK_PYTHON_BIN"), "explicit path to the python interpreter (pmd3 driver)")
	rsdFlag := flag.String("rsd", os.Getenv("GPSMOCK_RSD"), "manual RSD endpoint host:port (WiFi transport; skips tunnel start)")
	logFile := flag.String("log-file", os.Getenv("GPSMOCK_LOG_FILE"), "also write logs to this file (used by the Windows service)")
	noTunnel := flag.Bool("no-tunnel", envBool("GPSMOCK_NO_TUNNEL"), "do not start the tunnel at boot")
	clusterMode := flag.String("cluster-mode", envOr("GPSMOCK_CLUSTER_MODE", def.ClusterMode), "HA cluster mode: off | manual | auto (auto discovers peers via mDNS)")
	clusterNodes := flag.String("cluster-nodes", os.Getenv("GPSMOCK_CLUSTER_NODES"), "comma-separated host:port list of manual cluster peers")
	serverName := flag.String("server-name", os.Getenv("GPSMOCK_SERVER_NAME"), "name this node reports to cluster peers (defaults to hostname)")
	clusterSyncCerts := flag.Bool("cluster-sync-certs", envBool("GPSMOCK_CLUSTER_SYNC_CERTS"), "opt-in: replicate the Lockdown pairing-record folder across the cluster")
	tunnelStartTimeout := flag.Duration("tunnel-start-timeout", envDurationOr("GPSMOCK_TUNNEL_START_TIMEOUT", 90*time.Second), "how long to wait for the tunnel to come up at boot before giving up")
	shutdownTimeout := flag.Duration("shutdown-timeout", envDurationOr("GPSMOCK_SHUTDOWN_TIMEOUT", 5*time.Second), "how long to wait for in-flight requests to finish on shutdown")
	actionTimeout := flag.Duration("action-timeout", envDurationOr("GPSMOCK_ACTION_TIMEOUT", 60*time.Second), "how long a single WebSocket action may run before its context is cancelled")
	telemetryInterval := flag.Duration("telemetry-interval", envDurationOr("GPSMOCK_TELEMETRY_INTERVAL", 5*time.Second), "how often the TELEMETRY event is sampled and broadcast")
	flag.Parse()

	// In the self-contained Windows portable build, extract the embedded
	// drivers on first launch and use them unless the user pointed us
	// elsewhere. A no-op (empty paths) in every other build.
	if *goiosBin == "" || *pythonBin == "" {
		bundledGoios, bundledPython := platform.BundledDriverPaths()
		if *goiosBin == "" {
			*goiosBin = bundledGoios
		}
		if *pythonBin == "" {
			*pythonBin = bundledPython
		}
	}

	var nodes []string
	if *clusterNodes != "" {
		nodes = strings.Split(*clusterNodes, ",")
	}

	cfg := runConfig{
		driverID:           *driverFlag,
		transport:          *transportFlag,
		addr:               *addrFlag,
		mdnsInterface:      *mdnsInterface,
		goiosBin:           *goiosBin,
		pythonBin:          *pythonBin,
		rsd:                *rsdFlag,
		logFile:            *logFile,
		noTunnel:           *noTunnel,
		clusterMode:        *clusterMode,
		clusterNodes:       nodes,
		serverName:         *serverName,
		clusterSyncCerts:   *clusterSyncCerts,
		tunnelStartTimeout: *tunnelStartTimeout,
		shutdownTimeout:    *shutdownTimeout,
		actionTimeout:      *actionTimeout,
		telemetryInterval:  *telemetryInterval,
		settingsCfg:        def,
		store:              store,
		authStore:          authStore,
	}

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

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string) bool {
	v := os.Getenv(key)
	return v == "1" || v == "true" || v == "yes"
}

// envDurationOr parses key as a Go duration string (e.g. "90s", "5m"); on a
// missing or unparseable value it falls back to fallback rather than failing
// startup over a malformed env var.
func envDurationOr(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("invalid duration %q for %s, using default %s", v, key, fallback)
		return fallback
	}
	return d
}
