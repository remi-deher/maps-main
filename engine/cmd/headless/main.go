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
	"syscall"

	"github.com/remi-deher/maps-main/engine/internal/settings"

	// Register the driver backends.
	_ "github.com/remi-deher/maps-main/engine/internal/driver/goios"
	_ "github.com/remi-deher/maps-main/engine/internal/driver/pmd3"
)

func main() {
	def := settings.Default()

	driverFlag := flag.String("driver", envOr("GPSMOCK_DRIVER", string(def.PreferredDriver)), "tunnel driver: pymobiledevice | go-ios")
	transportFlag := flag.String("transport", envOr("GPSMOCK_TRANSPORT", "auto"), "transport: auto | usb | wifi")
	addrFlag := flag.String("addr", envOr("GPSMOCK_ADDR", fmt.Sprintf(":%d", def.CompanionPort)), "listen address")
	goiosBin := flag.String("goios-bin", os.Getenv("GPSMOCK_GOIOS_BIN"), "explicit path to the go-ios binary")
	pythonBin := flag.String("python-bin", os.Getenv("GPSMOCK_PYTHON_BIN"), "explicit path to the python interpreter (pmd3 driver)")
	rsdFlag := flag.String("rsd", os.Getenv("GPSMOCK_RSD"), "manual RSD endpoint host:port (WiFi transport; skips tunnel start)")
	logFile := flag.String("log-file", os.Getenv("GPSMOCK_LOG_FILE"), "also write logs to this file (used by the Windows service)")
	noTunnel := flag.Bool("no-tunnel", envBool("GPSMOCK_NO_TUNNEL"), "do not start the tunnel at boot")
	flag.Parse()

	cfg := runConfig{
		driverID:  *driverFlag,
		transport: *transportFlag,
		addr:      *addrFlag,
		goiosBin:  *goiosBin,
		pythonBin: *pythonBin,
		rsd:       *rsdFlag,
		logFile:   *logFile,
		noTunnel:  *noTunnel,
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
