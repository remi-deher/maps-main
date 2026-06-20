package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/server"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// runConfig is the resolved configuration for one engine run.
type runConfig struct {
	driverID  string
	transport string
	addr      string
	goiosBin  string
	pythonBin string
	rsd       string
	logFile   string
	noTunnel  bool
}

// runEngine builds the driver, engine and server, starts everything, and blocks
// until ctx is cancelled (signal or service stop), then shuts down gracefully.
func runEngine(ctx context.Context, cfg runConfig) error {
	if cfg.logFile != "" {
		if f, err := os.OpenFile(cfg.logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			log.SetOutput(io.MultiWriter(os.Stdout, f))
			defer f.Close()
		} else {
			log.Printf("cannot open log file %q: %v", cfg.logFile, err)
		}
	}
	log.SetFlags(log.LstdFlags)
	log.Printf("gps-mock engine (v3) — headless")
	log.Printf("available drivers: %v", driver.Available())

	transport := driver.TransportAuto
	switch cfg.transport {
	case "usb":
		transport = driver.TransportUSB
	case "wifi":
		transport = driver.TransportWiFi
	}

	dcfg := driver.Config{Transport: transport, ManualAddress: cfg.rsd, BinaryPaths: map[string]string{}}
	if cfg.goiosBin != "" {
		dcfg.BinaryPaths["go-ios"] = cfg.goiosBin
	}
	if cfg.pythonBin != "" {
		dcfg.BinaryPaths["python"] = cfg.pythonBin
	}

	drv, err := driver.New(domain.DriverID(cfg.driverID), dcfg)
	if err != nil {
		return err
	}
	log.Printf("driver: %s (transport=%s)", drv.ID(), transport)

	eng := engine.New(drv, settings.Default())
	srv := server.New(eng, cfg.addr)

	go func() {
		log.Printf("listening on %s (REST /api/*, WebSocket /ws)", cfg.addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("server error: %v", err)
		}
	}()

	if !cfg.noTunnel {
		go func() {
			tctx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()
			if err := eng.StartTunnel(tctx); err != nil {
				log.Printf("tunnel not started: %v", err)
			} else {
				st := eng.Status()
				log.Printf("tunnel up: %s:%d (%s)", st.RSDAddress, st.RSDPort, st.ConnectionType)
			}
		}()
	}

	<-ctx.Done()
	log.Printf("shutting down...")
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(sctx)
}
