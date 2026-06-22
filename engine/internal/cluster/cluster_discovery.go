package cluster

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/grandcat/zeroconf"
)

// ─── mDNS auto-discovery ────────────────────────────────────────────────────

// browseMdns watches _gpsmock._tcp on the LAN and adds newly-seen engines as
// discovered peers, skipping this node's own advertisement.
func (m *Manager) browseMdns(ctx context.Context) {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		slog.Warn("cluster: mdns resolver unavailable, auto-discovery disabled", "error", err)
		return
	}

	entries := make(chan *zeroconf.ServiceEntry, 8)
	go func() {
		for entry := range entries {
			m.handleDiscovered(entry)
		}
	}()

	if err := resolver.Browse(ctx, ServiceType, "local.", entries); err != nil {
		slog.Warn("cluster: mdns browse failed", "error", err)
		return
	}
	<-ctx.Done()
}

func (m *Manager) handleDiscovered(entry *zeroconf.ServiceEntry) {
	if entry.Port == m.selfPort && m.isSelfHost(entry) {
		return // our own advertisement, looping back through mDNS
	}

	var addr string
	if len(entry.AddrIPv4) > 0 {
		addr = entry.AddrIPv4[0].String()
	} else if len(entry.AddrIPv6) > 0 {
		addr = entry.AddrIPv6[0].String()
	} else {
		return
	}

	key := fmt.Sprintf("%s:%d", addr, entry.Port)
	name := strings.TrimSuffix(entry.Instance, "."+ServiceType)

	m.mu.Lock()
	if existing, ok := m.peers[key]; ok {
		if name != "" {
			existing.Name = name
		}
	} else {
		m.peers[key] = &Peer{Address: addr, Port: entry.Port, Name: name, Discovered: true}
		slog.Info("cluster: discovered peer via mDNS", "peer", key, "name", name)
	}
	m.mu.Unlock()
}

func (m *Manager) isSelfHost(entry *zeroconf.ServiceEntry) bool {
	for _, ip := range entry.AddrIPv4 {
		if m.selfAddrs[ip.String()] {
			return true
		}
	}
	for _, ip := range entry.AddrIPv6 {
		if m.selfAddrs[ip.String()] {
			return true
		}
	}
	return false
}
