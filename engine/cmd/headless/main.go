// Command headless runs the engine without a UI (server / Docker): it selects a
// driver, starts the HTTP/WebSocket server, brings up the tunnel best-effort,
// and shuts down cleanly on SIGINT/SIGTERM.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	_ "github.com/remi-deher/maps-main/engine/internal/driver/goios" // register go-ios
	_ "github.com/remi-deher/maps-main/engine/internal/driver/pmd3"  // register pymobiledevice
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/server"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

func main() {
	cfg := settings.Default()

	driverFlag := flag.String("driver", string(cfg.PreferredDriver), "tunnel driver: pymobiledevice | go-ios")
	transportFlag := flag.String("transport", "auto", "transport: auto | usb | wifi")
	addrFlag := flag.String("addr", fmt.Sprintf(":%d", cfg.CompanionPort), "listen address")
	goiosBin := flag.String("goios-bin", "", "explicit path to the go-ios binary")
	pythonBin := flag.String("python-bin", "", "explicit path to the python interpreter (pmd3 driver)")
	rsdFlag := flag.String("rsd", "", "manual RSD endpoint host:port (WiFi transport; skips tunnel start)")
	noTunnel := flag.Bool("no-tunnel", false, "do not start the tunnel at boot")
	flag.Parse()

	log.SetFlags(log.Ltime)
	log.Printf("gps-mock engine (v3) — headless")
	log.Printf("available drivers: %v", driver.Available())

	transport := driver.TransportAuto
	switch *transportFlag {
	case "usb":
		transport = driver.TransportUSB
	case "wifi":
		transport = driver.TransportWiFi
	}

	dcfg := driver.Config{Transport: transport, Fallback: cfg.FallbackEnabled, ManualAddress: *rsdFlag}
	dcfg.BinaryPaths = map[string]string{}
	if *goiosBin != "" {
		dcfg.BinaryPaths["go-ios"] = *goiosBin
	}
	if *pythonBin != "" {
		dcfg.BinaryPaths["python"] = *pythonBin
	}

	drv, err := driver.New(domain.DriverID(*driverFlag), dcfg)
	if err != nil {
		log.Fatalf("cannot create driver %q: %v", *driverFlag, err)
	}
	log.Printf("driver: %s (transport=%s)", drv.ID(), transport)

	eng := engine.New(drv, cfg)
	srv := server.New(eng, *addrFlag)

	// Start the HTTP/WebSocket server.
	go func() {
		log.Printf("listening on %s (REST /api/*, WebSocket /ws)", *addrFlag)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	// Bring up the tunnel best-effort (needs a device + privileges).
	if !*noTunnel {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			if err := eng.StartTunnel(ctx); err != nil {
				log.Printf("tunnel not started: %v", err)
			} else {
				st := eng.Status()
				log.Printf("tunnel up: %s:%d (%s)", st.RSDAddress, st.RSDPort, st.ConnectionType)
			}
		}()
	}

	// Wait for a termination signal.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Printf("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
