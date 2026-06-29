package engine

import (
	"context"
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/discovery"
)

// StartMdnsWake keeps iPhones discoverable on the LAN and reports lifecycle
// messages through the engine log stream.
func (e *Engine) StartMdnsWake(ctx context.Context) {
	discovery.StartMDNSWake(ctx, mdnsWakeLogger{engine: e})
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
