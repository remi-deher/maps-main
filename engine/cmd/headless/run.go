package main

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/grandcat/zeroconf"

	"github.com/remi-deher/maps-main/engine/internal/auth"
	"github.com/remi-deher/maps-main/engine/internal/cluster"
	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/engine"
	"github.com/remi-deher/maps-main/engine/internal/server"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// runConfig is the resolved configuration for one engine run.
type runConfig struct {
	driverID      string
	transport     string
	addr          string
	mdnsInterface string
	goiosBin      string
	pythonBin     string
	rsd           string
	logFile       string
	noTunnel      bool

	clusterMode      string // off | manual | auto
	clusterNodes     []string
	serverName       string
	clusterSyncCerts bool

	tunnelStartTimeout time.Duration
	shutdownTimeout    time.Duration
	actionTimeout      time.Duration
	telemetryInterval  time.Duration

	// settingsCfg is the configuration loaded from the settings store (or
	// settings.Default() if nothing was persisted yet); store is the open
	// handle used to persist further changes made via SaveSettings.
	settingsCfg settings.Settings
	store       settings.Store

	// authStore backs remote-access pairing (TOTP code + paired-device tokens).
	// May be nil if it failed to open, in which case only loopback/API-key
	// callers authenticate and the pairing endpoints are not mounted.
	authStore *auth.Store
}

// runEngine builds the driver, engine and server, starts everything, and blocks
// until ctx is cancelled (signal or service stop), then shuts down gracefully.
func runEngine(ctx context.Context, cfg runConfig) error {
	if cfg.logFile != "" {
		if f, err := os.OpenFile(cfg.logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			log.SetOutput(io.MultiWriter(os.Stdout, f))
			defer func() { _ = f.Close() }()
		} else {
			log.Printf("cannot open log file %q: %v", cfg.logFile, err)
		}
	}
	if cfg.store != nil {
		if closer, ok := cfg.store.(interface{ Close() error }); ok {
			defer func() { _ = closer.Close() }()
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

	dcfg := driver.Config{Transport: transport, ManualAddress: cfg.rsd, BinaryPaths: map[string]string{}, TunnelStartTimeout: cfg.tunnelStartTimeout}
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

	eng := engine.New(drv, cfg.settingsCfg)
	eng.SetDriverConfigBase(dcfg)
	if cfg.store != nil {
		eng.SetStore(cfg.store)
	}

	_, portStr, _ := net.SplitHostPort(cfg.addr)
	selfPort, _ := strconv.Atoi(portStr)
	clusterMgr := cluster.New(cfg.clusterMode, cfg.clusterNodes, cfg.serverName, selfPort, eng.TunnelActive, cfg.clusterSyncCerts)
	eng.SetClusterManager(clusterMgr)

	var opts []server.Option
	if cfg.actionTimeout > 0 {
		opts = append(opts, server.WithActionTimeout(cfg.actionTimeout))
	}
	if cfg.telemetryInterval > 0 {
		opts = append(opts, server.WithTelemetryInterval(cfg.telemetryInterval))
	}
	if cfg.authStore != nil {
		opts = append(opts, server.WithAuth(cfg.authStore))
		defer func() { _ = cfg.authStore.Close() }()
	}
	srv := server.New(eng, cfg.addr, opts...)

	go func() {
		log.Printf("listening on %s (REST /api/*, WebSocket /ws)", cfg.addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("server error: %v", err)
		}
	}()

	if mdnsServer := advertiseMdns(cfg.addr, cfg.mdnsInterface); mdnsServer != nil {
		defer mdnsServer.Shutdown()
	}

	clusterMgr.Start(ctx)
	defer clusterMgr.Release()
	defer clusterMgr.Stop()

	// Background watchdog: follows the device across USB↔WiFi and re-establishes
	// the tunnel if the daemon dies. No-op until a tunnel is up.
	eng.StartHealthMonitor(ctx)

	// Keep iPhones discoverable: a passive mDNS browse stops iOS from powering
	// down its discovery responder, which otherwise blinds the tunnel daemons
	// over WiFi. Best-effort; no-ops when no browse tool is installed.
	eng.StartMdnsWake(ctx)

	if !cfg.noTunnel {
		tunnelStartTimeout := cfg.tunnelStartTimeout
		if tunnelStartTimeout <= 0 {
			tunnelStartTimeout = 90 * time.Second
		}
		go func() {
			tctx, cancel := context.WithTimeout(ctx, tunnelStartTimeout)
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
	shutdownTimeout := cfg.shutdownTimeout
	if shutdownTimeout <= 0 {
		shutdownTimeout = 5 * time.Second
	}
	sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	// Stop the tunnel daemon (go-ios/pymobiledevice3) before the HTTP server:
	// without this, SIGINT/SIGTERM only closes the listener and leaves the
	// daemon and its child processes running as orphans.
	if err := drv.StopTunnel(sctx); err != nil {
		log.Printf("error stopping tunnel: %v", err)
	}

	return srv.Shutdown(sctx)
}

// advertiseMdns registers the engine under _gpsmock._tcp.local so LAN clients
// (the iOS companion app) can find it without the user typing an IP:port.
// Returns nil if the addr's port can't be parsed or registration fails —
// mDNS is a convenience, never a hard requirement to run the engine.
//
// ifaceName restricts which network interface's address gets advertised —
// on a machine with several NICs (Wi-Fi, Ethernet, a VPN adapter...),
// zeroconf would otherwise announce one arbitrarily, which may not be the
// one actually reachable from the iPhone. This only affects what address is
// *announced*; the HTTP/WebSocket listener itself still binds to every
// interface per cfg.addr (typically ":8080"), so the desktop client talking
// to it over loopback is unaffected either way. Empty ifaceName keeps the
// previous behavior of advertising on every interface.
func advertiseMdns(addr, ifaceName string) *zeroconf.Server {
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		log.Printf("mdns: cannot parse port from %q, skipping advertisement: %v", addr, err)
		return nil
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Printf("mdns: invalid port %q, skipping advertisement: %v", portStr, err)
		return nil
	}

	instance := "gpsmock-engine"
	if hostname, herr := os.Hostname(); herr == nil && hostname != "" {
		instance = hostname
	}

	var ifaces []net.Interface
	if ifaceName != "" {
		iface, ierr := net.InterfaceByName(ifaceName)
		if ierr != nil {
			log.Printf("mdns: interface %q not found, advertising on every interface instead: %v", ifaceName, ierr)
		} else {
			ifaces = []net.Interface{*iface}
		}
	}

	mdnsServer, err := zeroconf.Register(instance, cluster.ServiceType, "local.", port, []string{"v=1"}, ifaces)
	if err != nil {
		log.Printf("mdns: advertisement failed: %v", err)
		return nil
	}
	if ifaceName != "" {
		log.Printf("mdns: advertising %q on %s, port %d, restricted to interface %q", instance, cluster.ServiceType, port, ifaceName)
	} else {
		log.Printf("mdns: advertising %q on %s, port %d", instance, cluster.ServiceType, port)
	}
	return mdnsServer
}
