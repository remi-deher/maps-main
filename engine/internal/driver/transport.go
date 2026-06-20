package driver

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// TransportKind is the desired connection transport. Auto lets the driver pick
// whatever it finds; USB/WiFi force a specific path.
type TransportKind int

const (
	TransportAuto TransportKind = iota
	TransportUSB
	TransportWiFi
)

func (t TransportKind) String() string {
	switch t {
	case TransportUSB:
		return "USB"
	case TransportWiFi:
		return "WiFi"
	default:
		return "Auto"
	}
}

// Classify infers the connection type from an RSD address, mirroring the legacy
// drivers: loopback (::1 / 127.0.0.1) or link-local (fe80::*) means the device
// is reached over USB; any other routable address means WiFi.
func Classify(address string) domain.ConnectionType {
	host := address
	if h, _, err := net.SplitHostPort(address); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSpace(host))
	// Drop an IPv6 zone identifier, e.g. fe80::1%en0.
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	if host == "" {
		return domain.ConnUnknown
	}
	if host == "::1" || host == "127.0.0.1" || strings.HasPrefix(host, "fe80") {
		return domain.ConnUSB
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
		return domain.ConnUSB
	}
	return domain.ConnWiFi
}

// ParseManual turns a manual "host:port" RSD endpoint (WiFi/network transport)
// into a TunnelInfo, so a driver can target it directly without bringing up its
// own tunnel. IPv6 hosts must be bracketed, e.g. "[fde6::1]:54321".
func ParseManual(addr string) (TunnelInfo, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return TunnelInfo{}, fmt.Errorf("invalid manual RSD address %q (want host:port): %w", addr, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return TunnelInfo{}, fmt.Errorf("invalid manual RSD port in %q: %w", addr, err)
	}
	return TunnelInfo{Address: host, Port: port, Type: Classify(host), Since: time.Now()}, nil
}
