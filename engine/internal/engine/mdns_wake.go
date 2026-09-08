package engine

import (
	"context"
	"fmt"
)

// StartMdnsWake keeps iPhones discoverable on the LAN and reports lifecycle
// messages through the engine log stream.
//
// Safe to call repeatedly — RestartMdns does, on every invocation. The waker
// stops its previous run first; before it existed each call leaked three
// goroutines that went on respawning browse processes for the life of the
// engine.
func (e *Engine) StartMdnsWake(ctx context.Context) {
	e.mdnsWaker.Start(ctx, mdnsWakeLogger{engine: e})
}

type mdnsWakeLogger struct {
	engine *Engine
}

func (l mdnsWakeLogger) LogMDNSWakeUnavailable(tool string) {
	l.engine.LogEvent("info", "tunnel", "mdns", "wake",
		fmt.Sprintf("Réveil mDNS indisponible (%q introuvable) - la découverte WiFi peut être moins fiable. Installez Bonjour (Windows) ou avahi-utils (Linux).", tool), nil)
}

func (l mdnsWakeLogger) LogMDNSWakeActive() {
	l.engine.LogEvent("info", "tunnel", "mdns", "wake", "Réveil mDNS actif (maintient les iPhone découvrables sur le réseau).", nil)
}

// LogMDNSWakeFailing fires once per outage, not once per failed attempt: the
// browses are meant to run until cancelled, so a run of instant exits means the
// host's mDNS stack is down — on Windows, typically the Bonjour service.
func (l mdnsWakeLogger) LogMDNSWakeFailing(tool, reason string) {
	l.engine.LogEvent("warn", "tunnel", "mdns", "wake",
		"Le réveil mDNS ne tient pas ("+tool+" : "+reason+") — la découverte WiFi va être peu fiable. Essayez « Redémarrer Bonjour/mDNS » dans les diagnostics.",
		map[string]string{"tool": tool, "error": reason})
}

func (l mdnsWakeLogger) LogMDNSWakeRecovered() {
	l.engine.LogEvent("info", "tunnel", "mdns", "wake", "Réveil mDNS rétabli.", nil)
}
