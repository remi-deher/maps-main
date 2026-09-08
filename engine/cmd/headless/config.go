package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// Configuration resolution, kept separate from main() so it can be tested.
//
// main() is all side effects — it creates directories, opens SQLite handles,
// installs signal handlers — which is exactly why the *decisions* it used to
// make inline (which flag wins over which env var, what a malformed duration
// falls back to, how a cluster node list is split) were unreachable from a
// test. Everything below is a pure function of its arguments: give it an
// argument list, an environment lookup and the persisted settings, and it
// returns the runConfig the engine will run with.

// getenvFunc is the environment lookup, injected so tests don't have to mutate
// the process environment.
type getenvFunc func(string) string

// resolveRunConfig turns command-line arguments and the environment into a
// runConfig, layered so that: an explicit flag beats a GPSMOCK_* environment
// variable, which beats the persisted settings, which beats the built-in
// default. The store-backed fields (settingsCfg, store, authStore...) are left
// zero — main() fills those in, since opening them is I/O.
//
// output receives flag's own usage/error text; pass io.Discard in tests.
func resolveRunConfig(args []string, getenv getenvFunc, def settings.Settings, output io.Writer) (runConfig, error) {
	fs := flag.NewFlagSet("headless", flag.ContinueOnError)
	fs.SetOutput(output)

	driverFlag := fs.String("driver", envOr(getenv, "GPSMOCK_DRIVER", string(def.PreferredDriver)), "tunnel driver: pymobiledevice | go-ios")
	transportFlag := fs.String("transport", envOr(getenv, "GPSMOCK_TRANSPORT", "auto"), "transport: auto | usb | wifi")
	addrFlag := fs.String("addr", envOr(getenv, "GPSMOCK_ADDR", fmt.Sprintf(":%d", def.CompanionPort)), "listen address")
	mdnsInterface := fs.String("mdns-interface", getenv("GPSMOCK_MDNS_INTERFACE"), "network interface name to restrict the mDNS advertisement to (default: advertise on every interface)")
	goiosBin := fs.String("goios-bin", getenv("GPSMOCK_GOIOS_BIN"), "explicit path to the go-ios binary")
	pythonBin := fs.String("python-bin", getenv("GPSMOCK_PYTHON_BIN"), "explicit path to the python interpreter (pmd3 driver)")
	rsdFlag := fs.String("rsd", getenv("GPSMOCK_RSD"), "manual RSD endpoint host:port (WiFi transport; skips tunnel start)")
	logFile := fs.String("log-file", getenv("GPSMOCK_LOG_FILE"), "also write logs to this file (used by the Windows service)")
	noTunnel := fs.Bool("no-tunnel", envBool(getenv, "GPSMOCK_NO_TUNNEL"), "do not start the tunnel at boot")
	clusterMode := fs.String("cluster-mode", envOr(getenv, "GPSMOCK_CLUSTER_MODE", def.ClusterMode), "HA cluster mode: off | manual | auto (auto discovers peers via mDNS)")
	clusterNodes := fs.String("cluster-nodes", getenv("GPSMOCK_CLUSTER_NODES"), "comma-separated host:port list of manual cluster peers")
	serverName := fs.String("server-name", getenv("GPSMOCK_SERVER_NAME"), "name this node reports to cluster peers (defaults to hostname)")
	clusterSyncCerts := fs.Bool("cluster-sync-certs", envBool(getenv, "GPSMOCK_CLUSTER_SYNC_CERTS"), "opt-in: replicate the Lockdown pairing-record folder across the cluster")
	tunnelStartTimeout := fs.Duration("tunnel-start-timeout", envDurationOr(getenv, "GPSMOCK_TUNNEL_START_TIMEOUT", 90*time.Second), "how long to wait for the tunnel to come up at boot before giving up")
	shutdownTimeout := fs.Duration("shutdown-timeout", envDurationOr(getenv, "GPSMOCK_SHUTDOWN_TIMEOUT", 5*time.Second), "how long to wait for in-flight requests to finish on shutdown")
	actionTimeout := fs.Duration("action-timeout", envDurationOr(getenv, "GPSMOCK_ACTION_TIMEOUT", 60*time.Second), "how long a single WebSocket action may run before its context is cancelled")
	telemetryInterval := fs.Duration("telemetry-interval", envDurationOr(getenv, "GPSMOCK_TELEMETRY_INTERVAL", 5*time.Second), "how often the TELEMETRY event is sampled and broadcast")

	if err := fs.Parse(args); err != nil {
		return runConfig{}, err
	}

	return runConfig{
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
		clusterNodes:       splitClusterNodes(*clusterNodes),
		serverName:         *serverName,
		clusterSyncCerts:   *clusterSyncCerts,
		tunnelStartTimeout: *tunnelStartTimeout,
		shutdownTimeout:    *shutdownTimeout,
		actionTimeout:      *actionTimeout,
		telemetryInterval:  *telemetryInterval,
	}, nil
}

// splitClusterNodes parses the comma-separated peer list, dropping empty
// entries and surrounding spaces so a trailing comma or a list copy-pasted with
// spaces doesn't produce a peer with an empty address that every dial then
// fails on.
func splitClusterNodes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// parseTransport maps the -transport flag to the driver's transport. Anything
// unrecognized (including the empty string) means "auto", which is what the
// driver does anyway when it has to pick for itself.
func parseTransport(s string) driver.TransportKind {
	switch s {
	case "usb":
		return driver.TransportUSB
	case "wifi":
		return driver.TransportWiFi
	default:
		return driver.TransportAuto
	}
}

// applyBundledDriverPaths fills in driver binary paths that weren't given
// explicitly with the ones extracted by the self-contained Windows portable
// build. A no-op (empty paths) in every other build.
func applyBundledDriverPaths(cfg *runConfig, bundledGoios, bundledPython string) {
	if cfg.goiosBin == "" {
		cfg.goiosBin = bundledGoios
	}
	if cfg.pythonBin == "" {
		cfg.pythonBin = bundledPython
	}
}

func envOr(getenv getenvFunc, key, fallback string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(getenv getenvFunc, key string) bool {
	v := getenv(key)
	return v == "1" || v == "true" || v == "yes"
}

// envDurationOr parses key as a Go duration string (e.g. "90s", "5m"); on a
// missing or unparseable value it falls back to fallback rather than failing
// startup over a malformed env var.
func envDurationOr(getenv getenvFunc, key string, fallback time.Duration) time.Duration {
	v := getenv(key)
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

// defaultDataDir returns ~/.gpsmock (or the equivalent on Windows/macOS) so
// the settings database has a sane home when GPSMOCK_DATA_DIR isn't set.
func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".gpsmock")
	}
	return "."
}
