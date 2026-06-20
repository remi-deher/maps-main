// Command headless is the entry point for the engine running without a UI
// (server / Docker). In phase 1 it only proves the config -> registry -> driver
// wiring: it selects a driver from flags/defaults and exits, since no backend is
// implemented yet.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

func main() {
	cfg := settings.Default()

	driverFlag := flag.String("driver", string(cfg.PreferredDriver), "tunnel driver: pymobiledevice | go-ios")
	transportFlag := flag.String("transport", "auto", "transport: auto | usb | wifi")
	flag.Parse()

	log.SetFlags(0)
	log.Printf("gps-mock engine (v3) — headless")
	log.Printf("available drivers: %v", driver.Available())

	transport := driver.TransportAuto
	switch *transportFlag {
	case "usb":
		transport = driver.TransportUSB
	case "wifi":
		transport = driver.TransportWiFi
	}

	d, err := driver.New(domain.DriverID(*driverFlag), driver.Config{
		Transport: transport,
		Fallback:  cfg.FallbackEnabled,
	})
	if err != nil {
		log.Fatalf("cannot create driver %q: %v", *driverFlag, err)
	}
	log.Printf("selected driver: %s (transport=%s)", d.ID(), transport)

	// Phase 1 is contracts-only: exercise the wiring then stop.
	if _, err := d.StartTunnel(context.Background()); err != nil {
		log.Printf("driver %s: %v (expected in phase 1)", d.ID(), err)
	}

	fmt.Fprintln(os.Stdout, "phase 1 scaffold OK — engine not yet functional")
}
