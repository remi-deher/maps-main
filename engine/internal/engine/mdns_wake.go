package engine

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

// appleMdnsServices are the Bonjour service types iOS devices advertise for
// pairing and remote discovery. Continuously browsing them keeps the device's
// mDNS responder awake: iOS powers that responder down when idle, which is the
// usual reason a tunnel daemon can't find a device over WiFi even though it's on
// the same network. A passive browse query nudges it to re-announce.
var appleMdnsServices = []string{
	"_apple-mobdev2._tcp", // classic WiFi-sync pairing — most reliably advertised
	"_remotepairing._tcp", // iOS 17+ RSD remote pairing (WiFi tunnel)
	"_remoted._tcp",       // iOS 17+ remoted (USB-ethernet interface)
}

// StartMdnsWake spawns passive, persistent mDNS browses for the Apple device
// services so iPhones stay discoverable by the tunnel daemons. It mirrors the
// "poke"/wake mechanism the previous (Electron) build relied on, which the v3
// rewrite had dropped. Best-effort and platform-aware (dns-sd on Windows/macOS,
// avahi-browse on Linux); it logs once and no-ops when the browse tool isn't
// installed. Every child process is torn down when ctx is cancelled.
func (e *Engine) StartMdnsWake(ctx context.Context) {
	tool, argsFor := mdnsBrowseCommand()
	if tool == "" {
		return
	}
	if _, err := exec.LookPath(tool); err != nil {
		e.LogEvent("info", "tunnel", "mdns", "wake",
			fmt.Sprintf("Réveil mDNS indisponible (%q introuvable) — la découverte WiFi peut être moins fiable. Installez Bonjour (Windows) ou avahi-utils (Linux).", tool), nil)
		return
	}

	for _, svc := range appleMdnsServices {
		go func(svc string) {
			for {
				if ctx.Err() != nil {
					return
				}
				// CommandContext kills the browse when ctx is cancelled; the
				// process otherwise runs indefinitely, passively re-querying.
				_ = exec.CommandContext(ctx, tool, argsFor(svc)...).Run()
				if ctx.Err() != nil {
					return
				}
				// The browse exited on its own (e.g. the Bonjour service
				// restarted) — back off briefly, then bring it back up.
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
				}
			}
		}(svc)
	}

	e.LogEvent("info", "tunnel", "mdns", "wake", "Réveil mDNS actif (maintient les iPhone découvrables sur le réseau).", nil)
}

// mdnsBrowseCommand returns the platform's mDNS browse tool and an arg builder
// for a passive browse of one service type. Returns "" when the platform has no
// known tool.
func mdnsBrowseCommand() (string, func(svc string) []string) {
	switch runtime.GOOS {
	case "windows", "darwin":
		// dns-sd ships with Bonjour (Windows: iTunes/Apple Devices; macOS: built in).
		return "dns-sd", func(svc string) []string { return []string{"-B", svc} }
	case "linux":
		return "avahi-browse", func(svc string) []string { return []string{"-r", svc} }
	default:
		return "", nil
	}
}
