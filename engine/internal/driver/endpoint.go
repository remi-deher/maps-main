package driver

import (
	"context"
	"strings"
	"time"
)

// TunnelEndpoint is the normalized RSD endpoint discovered by a backend.
// Backend-specific parsers should convert their raw shape into this type as
// early as possible so lifecycle code can stay driver-agnostic.
type TunnelEndpoint struct {
	Info TunnelInfo
	UDID string
}

func NewTunnelEndpoint(address string, port int, udid string) (TunnelEndpoint, bool) {
	address = strings.TrimSpace(address)
	if address == "" || port <= 0 {
		return TunnelEndpoint{}, false
	}
	return TunnelEndpoint{
		Info: TunnelInfo{
			Address: address,
			Port:    port,
			Type:    Classify(address),
			Since:   time.Now(),
		},
		UDID: strings.TrimSpace(udid),
	}, true
}

type TunnelEndpointResolver func(ctx context.Context) (TunnelEndpoint, bool)
